/**
 * DevTools-equivalent diagnostic for POS cross-subdomain auth.
 * Usage: node scripts/prod-pos-network-diagnostic.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROFIT = "https://www.rizance.com";
const POS = "https://pos.rizance.com";
const OUT = join(import.meta.dirname ?? ".", "..", "docs", "pos-network-diagnostic");
const stamp = Date.now();
const email = `pos-net-diag-${stamp}@rizance.test`;
const password = `Diag${stamp}!`;

mkdirSync(OUT, { recursive: true });

const report = {
  email,
  steps: [],
  sessionRequest: null,
  cookiesAfterLogin: [],
  cookiesOnPos: [],
};

function log(step, detail) {
  report.steps.push({ step, detail });
  console.log(`[${step}]`, typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Clear all cookies (DevTools → Clear)
  await context.clearCookies();
  log("1_clear_cookies", "Cleared all cookies in browser context");

  // Create account via API, then clear cookies again (fresh login session)
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
  const reg = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, shopName: "Net Diag", mode: "personal" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  log("register", reg);
  await context.clearCookies();
  log("1b_clear_after_register", "Cleared cookies again before UI login");

  // 2. Login via UI (www.rizance.com/login)
  await page.goto(`${PROFIT}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30000 });
  await page.screenshot({ path: join(OUT, "01-after-login-home.png"), fullPage: true });
  log("2_login", `Redirected to ${page.url()}`);

  // Check rizance_session cookie after login
  const cookiesAfterLogin = await context.cookies("https://www.rizance.com", "https://rizance.com");
  report.cookiesAfterLogin = cookiesAfterLogin.filter((c) =>
    ["rizance_session", "rizance_context"].includes(c.name),
  );
  const sessionCookie = cookiesAfterLogin.find((c) => c.name === "rizance_session");
  log("2_cookie_check", {
    found: Boolean(sessionCookie),
    name: sessionCookie?.name,
    domain: sessionCookie?.domain,
    path: sessionCookie?.path,
    secure: sessionCookie?.secure,
    httpOnly: sessionCookie?.httpOnly,
    sameSite: sessionCookie?.sameSite,
    domainOk: sessionCookie?.domain === ".rizance.com",
  });

  // Capture /api/pos/session from POS page
  let captured = null;
  page.on("request", (req) => {
    if (req.url().includes("/api/pos/session")) {
      captured = captured ?? {};
      captured.requestUrl = req.url();
      captured.requestHeaders = req.headers();
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/pos/session")) {
      captured = captured ?? {};
      captured.status = res.status();
      captured.responseHeaders = res.headers();
      try {
        captured.responseBody = await res.text();
      } catch {
        captured.responseBody = "(unreadable)";
      }
    }
  });

  // 3. Open POS in same context (simulates new tab, same profile)
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, "02-pos-page.png"), fullPage: true });

  const cookiesOnPos = await context.cookies("https://pos.rizance.com");
  report.cookiesOnPos = cookiesOnPos.filter((c) => c.name === "rizance_session");
  log("3_pos_cookies", report.cookiesOnPos);

  report.sessionRequest = captured;
  log("3_pos_session_request", captured);

  const bodyText = await page.locator("body").innerText();
  log("3_pos_page_text", bodyText.slice(0, 300));

  // Build HTML report mimicking DevTools Network panel
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>POS /api/pos/session diagnostic</title>
<style>
body{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:#1e1e1e;color:#ccc;margin:0;padding:16px}
h1,h2{color:#fff;font-family:system-ui,sans-serif}
.panel{background:#252526;border:1px solid #3c3c3c;border-radius:6px;margin:12px 0;padding:12px}
.ok{color:#4ec9b0}.bad{color:#f44747}.warn{color:#dcdcaa}
pre{white-space:pre-wrap;word-break:break-all;margin:0}
.row{display:grid;grid-template-columns:180px 1fr;gap:8px;padding:2px 0;border-bottom:1px solid #333}
.label{color:#9cdcfe}
img{max-width:100%;border:1px solid #444;margin:8px 0}
</style></head><body>
<h1>POS Network Diagnostic — ${new Date().toISOString()}</h1>
<p>Test user: <code>${email}</code></p>

<h2>Step 2 — Cookie after login (Application → Cookies)</h2>
<div class="panel">
${sessionCookie
  ? `<div class="row"><span class="label">Name</span><span>${sessionCookie.name}</span></div>
<div class="row"><span class="label">Domain</span><span class="${sessionCookie.domain === ".rizance.com" ? "ok" : "bad"}">${sessionCookie.domain} ${sessionCookie.domain === ".rizance.com" ? "✓" : "✗ expected .rizance.com"}</span></div>
<div class="row"><span class="label">Path</span><span>${sessionCookie.path}</span></div>
<div class="row"><span class="label">Secure</span><span>${sessionCookie.secure}</span></div>
<div class="row"><span class="label">HttpOnly</span><span>${sessionCookie.httpOnly}</span></div>
<div class="row"><span class="label">SameSite</span><span>${sessionCookie.sameSite}</span></div>`
  : `<p class="bad">rizance_session NOT FOUND after login</p>`}
</div>

<h2>Step 3 — Network: GET /api/pos/session</h2>
<div class="panel">
<div class="row"><span class="label">Request URL</span><span>${captured?.requestUrl ?? "NOT CAPTURED"}</span></div>
<div class="row"><span class="label">Status</span><span class="${captured?.status === 200 ? "ok" : captured?.status === 401 ? "warn" : "bad"}">${captured?.status ?? "N/A"}</span></div>
</div>

<h3>Request Headers</h3>
<div class="panel"><pre>${captured?.requestHeaders ? Object.entries(captured.requestHeaders).map(([k,v])=>`${k}: ${v}`).join("\n") : "(none)"}</pre></div>
<p>Cookie sent: <span class="${captured?.requestHeaders?.cookie?.includes("rizance_session") ? "ok" : "bad"}">${captured?.requestHeaders?.cookie?.includes("rizance_session") ? "YES ✓" : "NO ✗"}</span></p>

<h3>Response Headers</h3>
<div class="panel"><pre>${captured?.responseHeaders ? Object.entries(captured.responseHeaders).map(([k,v])=>`${k}: ${v}`).join("\n") : "(none)"}</pre></div>

<h3>Response Body</h3>
<div class="panel"><pre>${captured?.responseBody ?? "(none)"}</pre></div>

<h2>Screenshots</h2>
<img src="01-after-login-home.png" alt="After login">
<img src="02-pos-page.png" alt="POS page">
</body></html>`;

  writeFileSync(join(OUT, "report.html"), html);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  await browser.close();
  console.log(`\nReport: ${join(OUT, "report.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
