// Today context cookie test — regular/booth isolation + safe fallback.
// Usage: npm run dev, then npm run test:context
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

function toCents(v) {
  return Math.round(Number(v) * 100);
}

function computeProfit(income, expense) {
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

/** Mirrors lib/queries.ts dailySummary */
async function dailySummary(client, userId, date) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS expense`,
    [userId, date],
  );
  const r = rows[0];
  return { income: r.income, expense: r.expense, profit: computeProfit(r.income, r.expense) };
}

/** Mirrors lib/booth-queries.ts boothDaySummary */
async function boothDaySummary(client, userId, boothId, date) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND user_id = $2 AND entry_date = $3::date), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND user_id = $2 AND entry_date = $3::date), 0)::text AS expense`,
    [boothId, userId, date],
  );
  const r = rows[0];
  return { income: r.income, expense: r.expense, profit: computeProfit(r.income, r.expense) };
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

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`      expected: ${expected}`);
  console.log(`      actual:   ${actual}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== TODAY CONTEXT COOKIE TEST ===\n");

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  const email = `ctx-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'ctx-test', 'Context Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const date = "2026-06-10";
  await client.query(
    `INSERT INTO income_entries (user_id, amount, entry_date)
     VALUES ($1, 500.00, $2::date)`,
    [userId, date],
  );
  await client.query(
    `INSERT INTO expense_entries (user_id, amount, category, entry_date)
     VALUES ($1, 200.00, 'supplies', $2::date)`,
    [userId, date],
  );

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งานบูธ A', 1000.00, '2026-06-09'::date, '2026-06-11'::date)
     RETURNING id`,
    [userId],
  );
  const boothId = booths[0].id;

  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 999.00, 'cash', $3::date)`,
    [boothId, userId, date],
  );

  console.log("1) No cookie → regular context + regular data only");
  let res = await apiJson(base, "/api/context");
  assertEq("GET context mode", res.body?.data?.mode ?? "missing", "regular");

  const regular = await dailySummary(client, userId, date);
  assertEq("regular daily income", regular.income, "500.00");
  assertEq("regular daily profit", regular.profit, "300.00");
  console.log("");

  console.log("2) PATCH regular → still regular");
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "regular" }),
  });
  assertEq("PATCH regular status", String(res.status), "200");
  assertEq("PATCH regular mode", res.body?.data?.mode ?? "missing", "regular");
  assertEq("daily income unchanged", regular.income, "500.00");
  console.log("");

  console.log("3) PATCH booth → booth context + booth day data only");
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  assertEq("PATCH booth status", String(res.status), "200");
  assertEq("PATCH booth mode", res.body?.data?.mode ?? "missing", "booth");
  assertEq("PATCH booth id", res.body?.data?.boothId ?? "missing", boothId);

  res = await apiJson(base, "/api/context");
  assertEq("GET after booth PATCH", res.body?.data?.mode ?? "missing", "booth");

  const boothDay = await boothDaySummary(client, userId, boothId, date);
  assertEq("booth day income", boothDay.income, "999.00");
  assertEq("booth day profit", boothDay.profit, "999.00");
  assertEq("regular income still isolated", regular.income, "500.00");
  console.log("");

  console.log("4) PATCH back to regular → restores regular view");
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "regular" }),
  });
  assertEq("switch back status", String(res.status), "200");
  res = await apiJson(base, "/api/context");
  assertEq("GET after switch back", res.body?.data?.mode ?? "missing", "regular");
  const regularAgain = await dailySummary(client, userId, date);
  assertEq("regular income after switch", regularAgain.income, "500.00");
  console.log("");

  console.log("5) Closed booth → PATCH rejected, context stays regular");
  await client.query(
    `UPDATE booths SET status = 'closed', closed_at = now() WHERE id = $1`,
    [boothId],
  );
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  assertEq("closed booth PATCH status", String(res.status), "409");
  assertEq("closed booth reason", res.body?.error?.reason ?? "missing", "booth_closed");
  res = await apiJson(base, "/api/context");
  assertEq("context after closed reject", res.body?.data?.mode ?? "missing", "regular");
  console.log("");

  console.log("6) Invalid/deleted booth → safe fallback to regular");
  const { rows: booth2 } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งานชั่วคราว', 100.00, '2026-06-09'::date, '2026-06-11'::date) RETURNING id`,
    [userId],
  );
  const tempBoothId = booth2[0].id;

  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId: tempBoothId }),
  });
  assertEq("set booth cookie", String(res.status), "200");

  await client.query(`DELETE FROM booths WHERE id = $1`, [tempBoothId]);
  res = await apiJson(base, "/api/context");
  assertEq("stale cookie GET falls back", res.body?.data?.mode ?? "missing", "regular");

  const fakeId = "00000000-0000-4000-8000-000000000099";
  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId: fakeId }),
  });
  assertEq("random booth PATCH", String(res.status), "404");
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
