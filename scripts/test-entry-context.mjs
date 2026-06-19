// Entry form context banners + context-aware bottom-nav routing.
// Usage: npm run dev, then npm run test:entry-context
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

let cookie = "";

function mergeSetCookies(setCookieHeaders) {
  const jar = new Map();
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const header of setCookieHeaders) {
    const kv = header.split(";")[0];
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function makeSessionCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing or too short");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  cookie = `rizance_session=${token}`;
}

async function detectBase() {
  const bases = [];
  if (process.env.SMOKE_BASE_URL) bases.push(process.env.SMOKE_BASE_URL);
  for (const port of [3002, 3001, 3000, 3003]) bases.push(`http://localhost:${port}`);
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/api/context`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200 || res.status === 401) return base;
    } catch {
      // try next
    }
  }
  return null;
}

async function apiJson(base, path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no json
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) mergeSetCookies(setCookie);
  return { status: res.status, body };
}

async function fetchHtml(base, path) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, html: await res.text() };
}

function hrefPresent(html, href) {
  return html.includes(`href="${href}"`) || html.includes(`href='${href}'`);
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`      expected: ${expected}`);
  console.log(`      actual:   ${actual}`);
  if (!ok) failed++;
}

function assertTrue(label, condition) {
  console.log(`  ${condition ? "✓" : "✗"} ${label}`);
  if (!condition) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== ENTRY CONTEXT BANNER + NAV ROUTING TEST ===\n");

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  const email = `entry-ctx-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'entry-ctx-test', 'Entry Context Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const boothName = "งานเทสบูธ";
  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, $2, 1000.00, '2026-06-09'::date, '2026-06-11'::date)
     RETURNING id`,
    [userId, boothName],
  );
  const boothId = booths[0].id;

  console.log("1) Regular context → nav routes to /entry");
  let res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "regular" }),
  });
  assertEq("PATCH regular", String(res.status), "200");

  let page = await fetchHtml(base, "/");
  assertEq("home status", String(page.status), "200");
  assertTrue("nav entry href /entry", hrefPresent(page.html, "/entry"));
  assertTrue("nav profile href /profile", hrefPresent(page.html, "/profile"));
  assertTrue("no booth entry nav", !hrefPresent(page.html, `/booth/${boothId}/entry`));
  assertTrue("no legacy income nav", !hrefPresent(page.html, 'href="/income"'));
  console.log("");

  console.log("2) Regular entry forms show ร้านประจำ banner (via /income redirect)");
  page = await fetchHtml(base, "/income");
  assertEq("/income status", String(page.status), "200");
  assertTrue("income banner ร้านประจำ", page.html.includes("บันทึกเข้า:") && page.html.includes("ร้านประจำ"));
  assertTrue("income not booth banner", !page.html.includes('data-entry-context="booth"'));

  page = await fetchHtml(base, "/expense");
  assertEq("/expense status", String(page.status), "200");
  assertTrue("expense banner ร้านประจำ", page.html.includes("บันทึกเข้า:") && page.html.includes("ร้านประจำ"));
  console.log("");

  console.log("3) Open booth context → nav routes to booth entry form");
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  assertEq("PATCH booth", String(res.status), "200");

  page = await fetchHtml(base, "/");
  assertTrue("nav booth entry href", hrefPresent(page.html, `/booth/${boothId}/entry`));
  assertTrue("no regular entry nav", !hrefPresent(page.html, 'href="/entry"'));
  console.log("");

  console.log("4) Booth entry forms show amber booth banner");
  page = await fetchHtml(base, `/booth/${boothId}/entry?tab=income`);
  assertEq("booth entry income status", String(page.status), "200");
  assertTrue("booth income banner text", page.html.includes("บันทึกเข้า:") && page.html.includes(boothName));
  assertTrue("booth income amber style", page.html.includes('data-entry-context="booth"'));

  page = await fetchHtml(base, `/booth/${boothId}/entry?tab=expense`);
  assertEq("booth expense status", String(page.status), "200");
  assertTrue("booth expense banner text", page.html.includes("บันทึกเข้า:") && page.html.includes(boothName));
  assertTrue("booth expense amber style", page.html.includes('data-entry-context="booth"'));
  console.log("");

  console.log("7) Open project context → nav routes to org entry form");
  const { rows: projects } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, org_name, budget_target, start_date, end_date, status)
     VALUES ($1, 'Org Nav Test', 'long', 'ชมรมนำทาง', 50000.00, '2026-01-01'::date, '2026-12-31'::date, 'active')
     RETURNING id`,
    [userId],
  );
  const projectId = projects[0].id;

  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "project", projectId }),
  });
  assertEq("PATCH project", String(res.status), "200");
  assertEq("PATCH project mode", res.body?.data?.mode, "project");

  page = await fetchHtml(base, "/");
  assertTrue("nav project entry href", hrefPresent(page.html, `/projects/${projectId}/entry`));
  assertTrue("nav project stats href", hrefPresent(page.html, `/projects/${projectId}/summary`));
  assertTrue("no regular entry nav", !hrefPresent(page.html, 'href="/entry"'));
  assertTrue("nav purple accent", page.html.includes("text-rz-purple"));
  assertTrue("OrgToday budget card", page.html.includes("ภาพรวมงบทั้งปี"));
  assertTrue("OrgToday org name", page.html.includes("ชมรมนำทาง"));
  console.log("");

  console.log("8) Closed project cookie → nav falls back to regular routes");
  await client.query(`UPDATE projects SET status = 'closed' WHERE id = $1`, [projectId]);
  page = await fetchHtml(base, "/");
  assertTrue("closed project: nav /entry", hrefPresent(page.html, "/entry"));
  assertTrue("closed project: no project nav", !hrefPresent(page.html, `/projects/${projectId}/entry`));
  console.log("");

  console.log("5) Closed booth cookie → nav falls back to regular routes");
  await client.query(
    `UPDATE booths SET status = 'closed', closed_at = now() WHERE id = $1`,
    [boothId],
  );
  page = await fetchHtml(base, "/");
  assertTrue("closed: nav /entry", hrefPresent(page.html, "/entry"));
  assertTrue("closed: no booth nav", !hrefPresent(page.html, `/booth/${boothId}/entry`));
  console.log("");

  console.log("6) Invalid booth cookie → nav falls back to regular routes");
  const fakeId = "00000000-0000-4000-8000-000000000088";
  cookie = `${cookie}; rizance_context=booth:${fakeId}`;
  page = await fetchHtml(base, "/");
  assertTrue("invalid: nav /entry", hrefPresent(page.html, "/entry"));
  console.log("");

  if (failed === 0) {
    console.log("All assertions passed.");
  } else {
    console.error(`${failed} assertion(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("(test user and data cleaned up — CASCADE)");
  }
  await client.end();
}
