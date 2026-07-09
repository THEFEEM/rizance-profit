import { chromium } from "playwright";

const stamp = Date.now();
const email = `pos-fetch-${stamp}@rizance.test`;
const pw = `Diag${stamp}!`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto("https://www.rizance.com/login");
await page.evaluate(
  async ({ email, password }) => {
    await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, shopName: "T", mode: "personal" }),
    });
  },
  { email, password: pw },
);
await ctx.clearCookies();
await page.goto("https://www.rizance.com/login", { waitUntil: "networkidle" });
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="password"]').fill(pw);
await page.getByRole("button", { name: /log in/i }).click();
await page.waitForURL(/home/, { timeout: 30000 });

console.log(
  "cookie",
  (await ctx.cookies()).filter((c) => c.name === "rizance_session").map((c) => c.domain),
);

await page.goto("https://pos.rizance.com", { waitUntil: "networkidle" });

const result = await page.evaluate(async () => {
  const urls = [
    "https://rizance.com/api/pos/session",
    "https://www.rizance.com/api/pos/session",
  ];
  const out = {};
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      out[url] = {
        status: r.status,
        acao: r.headers.get("access-control-allow-origin"),
        body: await r.text(),
      };
    } catch (e) {
      out[url] = { error: String(e) };
    }
  }
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
