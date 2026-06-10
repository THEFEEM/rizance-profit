// Stats page context isolation: regular vs booth data.
// Usage: npm run dev, then npm run test:stats-context
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

function computeProfit(income, expense) {
  const toCents = (v) => Math.round(Number(v) * 100);
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

/** Mirrors lib/queries.ts periodSummary for today */
async function regularPeriodToday(client, userId, date) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS expense`,
    [userId, date],
  );
  const r = rows[0];
  return { income: r.income, expense: r.expense, profit: computeProfit(r.income, r.expense) };
}

/** Mirrors lib/booth-queries.ts boothSummary */
async function boothEventSummary(client, boothId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable`,
    [boothId],
  );
  const r = rows[0];
  const income = (Number(r.cash) + Number(r.transfer)).toFixed(2);
  const expense = (Number(r.fixed) + Number(r.variable)).toFixed(2);
  return {
    cash: r.cash,
    transfer: r.transfer,
    fixed: r.fixed,
    variable: r.variable,
    totalIncome: income,
    totalExpense: expense,
    profit: computeProfit(income, expense),
  };
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
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  cookie = `rizance_session=${token}`;
}

async function detectBase() {
  for (const port of [3000, 3001, 3002, 3003]) {
    const base = `http://localhost:${port}`;
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
  mergeSetCookies(res.headers.getSetCookie?.() ?? []);
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
  console.log("=== STATS CONTEXT ISOLATION TEST ===\n");

  const email = `stats-ctx-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'stats-ctx', 'Stats Ctx') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  const date = "2026-06-10";
  await client.query(
    `INSERT INTO income_entries (user_id, amount, entry_date) VALUES ($1, 500.00, $2::date)`,
    [userId, date],
  );
  await client.query(
    `INSERT INTO expense_entries (user_id, amount, category, entry_date)
     VALUES ($1, 200.00, 'supplies', $2::date)`,
    [userId, date],
  );

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งานสถิติ', 1000.00, '2026-06-09'::date, '2026-06-11'::date) RETURNING id`,
    [userId],
  );
  const boothId = booths[0].id;

  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 300.00, 'cash', $3::date), ($1, $2, 100.00, 'transfer', $3::date)`,
    [boothId, userId, date],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, entry_date)
     VALUES ($1, $2, 80.00, 'fixed', $3::date), ($1, $2, 20.00, 'variable', $3::date)`,
    [boothId, userId, date],
  );

  console.log("1) Regular stats show ONLY regular-shop data");
  const regular = await regularPeriodToday(client, userId, date);
  assertEq("regular income", regular.income, "500.00");
  assertEq("regular profit", regular.profit, "300.00");
  assertEq("regular excludes booth 400", regular.income === "500.00" ? "yes" : regular.income, "yes");
  console.log("");

  console.log("2) Booth stats show ONLY booth data (full event)");
  const booth = await boothEventSummary(client, boothId);
  assertEq("booth cash", booth.cash, "300.00");
  assertEq("booth transfer", booth.transfer, "100.00");
  assertEq("booth total income", booth.totalIncome, "400.00");
  assertEq("booth fixed", booth.fixed, "80.00");
  assertEq("booth variable", booth.variable, "20.00");
  assertEq("booth total expense", booth.totalExpense, "100.00");
  assertEq("booth profit", booth.profit, "300.00");
  console.log("");

  console.log("3) Context cookie switches which mode Stats uses");
  let res = await apiJson(base, "/api/context");
  assertEq("default context", res.body?.data?.mode ?? "missing", "regular");

  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  assertEq("PATCH booth context", res.body?.data?.mode ?? "missing", "booth");

  res = await apiJson(base, "/api/context");
  assertEq("GET booth context", res.body?.data?.mode ?? "missing", "booth");
  assertEq("booth name in context", res.body?.data?.boothName ?? "missing", "งานสถิติ");

  res = await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "regular" }),
  });
  assertEq("switch back to regular", res.body?.data?.mode ?? "missing", "regular");

  const regularAfter = await regularPeriodToday(client, userId, date);
  assertEq("regular income after switch", regularAfter.income, "500.00");
  console.log("");

  console.log("4) Stats page renders in both modes (no 500)");
  res = await fetch(`${base}/summary`, { headers: { Cookie: cookie }, redirect: "manual" });
  assertEq("GET /summary regular", String(res.status), "200");

  await apiJson(base, "/api/context", {
    method: "PATCH",
    body: JSON.stringify({ mode: "booth", boothId }),
  });
  res = await fetch(`${base}/summary`, { headers: { Cookie: cookie }, redirect: "manual" });
  assertEq("GET /summary booth", String(res.status), "200");
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
    console.log("(test user cleaned up — CASCADE)");
  }
  await client.end();
}
