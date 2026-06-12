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

  console.log("1) Regular context → nav routes to /income and /expense");
  let res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "regular" }),
  });
  assertEq("PATCH regular", String(res.status), "200");

  let page = await fetchHtml(base, "/");
  assertEq("home status", String(page.status), "200");
  assertTrue("nav income href /income", hrefPresent(page.html, "/income"));
  assertTrue("nav expense href /expense", hrefPresent(page.html, "/expense"));
  assertTrue("no booth income nav", !hrefPresent(page.html, `/booth/${boothId}/income`));
  console.log("");

  console.log("2) Regular entry forms show ร้านประจำ banner");
  page = await fetchHtml(base, "/income");
  assertEq("/income status", String(page.status), "200");
  assertTrue("income banner ร้านประจำ", page.html.includes("บันทึกเข้า:") && page.html.includes("ร้านประจำ"));
  assertTrue("income not amber booth banner", !page.html.includes("bg-amber-100"));

  page = await fetchHtml(base, "/expense");
  assertEq("/expense status", String(page.status), "200");
  assertTrue("expense banner ร้านประจำ", page.html.includes("บันทึกเข้า:") && page.html.includes("ร้านประจำ"));
  console.log("");

  console.log("3) Open booth context → nav routes to booth entry forms");
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  assertEq("PATCH booth", String(res.status), "200");

  page = await fetchHtml(base, "/");
  assertTrue("nav booth income href", hrefPresent(page.html, `/booth/${boothId}/income`));
  assertTrue("nav booth expense href", hrefPresent(page.html, `/booth/${boothId}/expense`));
  assertTrue("no regular income nav", !hrefPresent(page.html, "/income"));
  console.log("");

  console.log("4) Booth entry forms show amber booth banner");
  page = await fetchHtml(base, `/booth/${boothId}/income`);
  assertEq("booth income status", String(page.status), "200");
  assertTrue("booth income banner text", page.html.includes("บันทึกเข้า:") && page.html.includes(boothName));
  assertTrue("booth income amber style", page.html.includes("bg-amber-100"));

  page = await fetchHtml(base, `/booth/${boothId}/expense`);
  assertEq("booth expense status", String(page.status), "200");
  assertTrue("booth expense banner text", page.html.includes("บันทึกเข้า:") && page.html.includes(boothName));
  assertTrue("booth expense amber style", page.html.includes("bg-amber-100"));
  console.log("");

  console.log("5) Closed booth cookie → nav falls back to regular routes");
  await client.query(
    `UPDATE booths SET status = 'closed', closed_at = now() WHERE id = $1`,
    [boothId],
  );
  page = await fetchHtml(base, "/");
  assertTrue("closed: nav /income", hrefPresent(page.html, "/income"));
  assertTrue("closed: nav /expense", hrefPresent(page.html, "/expense"));
  assertTrue("closed: no booth nav", !hrefPresent(page.html, `/booth/${boothId}/income`));
  console.log("");

  console.log("6) Invalid booth cookie → nav falls back to regular routes");
  const fakeId = "00000000-0000-4000-8000-000000000088";
  cookie = `${cookie}; rizance_context=booth:${fakeId}`;
  page = await fetchHtml(base, "/");
  assertTrue("invalid: nav /income", hrefPresent(page.html, "/income"));
  assertTrue("invalid: nav /expense", hrefPresent(page.html, "/expense"));
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
