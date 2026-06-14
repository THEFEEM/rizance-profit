// Category breakdown on regular Stats — sums, period filter, legacy, booth isolation.
// Usage: npm run dev (for API check), then npm run test:category-breakdown
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./expense-categories-core.mjs";

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

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function periodRangeLast7(anchor) {
  return { start: addDays(anchor, -6), end: anchor };
}

function toCents(v) {
  return Math.round(Number(v) * 100);
}

function sumBreakdown(rows) {
  return (rows.reduce((s, r) => s + toCents(r.amount), 0) / 100).toFixed(2);
}

/** Mirrors lib/queries.ts categoryBreakdown */
async function categoryBreakdown(client, userId, start, end) {
  const [inc, exp] = await Promise.all([
    client.query(
      `SELECT category, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::text AS count
       FROM income_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
       GROUP BY category`,
      [userId, start, end],
    ),
    client.query(
      `SELECT category, COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::text AS count
       FROM expense_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
       GROUP BY category`,
      [userId, start, end],
    ),
  ]);
  const mapRows = (rows) =>
    rows
      .map((r) => ({ category: r.category, amount: r.amount, count: Number(r.count) }))
      .filter((r) => r.count > 0 && toCents(r.amount) !== 0);
  return { income: mapRows(inc.rows), expense: mapRows(exp.rows) };
}

async function periodTotals(client, userId, start, end) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS expense`,
    [userId, start, end],
  );
  return rows[0];
}

let cookie = "";

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
  for (const port of [3002, 3001, 3000, 3003]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/context`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200 || res.status === 401) return `http://localhost:${port}`;
    } catch {
      // next
    }
  }
  return null;
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed++;
  }
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;
const end = bangkokToday();
const start = addDays(end, -1);
const outOfPeriod = addDays(end, -10);
const last7 = periodRangeLast7(end);

try {
  await client.connect();
  console.log("=== CATEGORY BREAKDOWN TEST ===\n");

  const email = `cat-bd-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'cat-bd', 'Breakdown Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งานบูธ', 1000, $2::date, $3::date) RETURNING id`,
    [userId, start, addDays(end, 2)],
  );
  const boothId = booths[0].id;

  // In-period regular income (2-day window start..end)
  await client.query(
    `INSERT INTO income_entries (user_id, amount, category, entry_date)
     VALUES ($1, 100.00, 'storefront', $2::date),
            ($1, 50.00, 'delivery', $3::date)`,
    [userId, start, end],
  );
  // Legacy row (no category column — DB default storefront)
  await client.query(
    `INSERT INTO income_entries (user_id, amount, entry_date)
     VALUES ($1, 25.00, $2::date)`,
    [userId, start],
  );
  // Out of period
  await client.query(
    `INSERT INTO income_entries (user_id, amount, category, entry_date)
     VALUES ($1, 999.00, 'storefront', $2::date)`,
    [userId, outOfPeriod],
  );
  // Booth income in period (must not appear)
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 7777.00, 'cash', $3::date)`,
    [boothId, userId, start],
  );

  await client.query(
    `INSERT INTO expense_entries (user_id, amount, category, entry_date)
     VALUES ($1, 80.00, 'materials', $2::date),
            ($1, 20.00, 'rent', $3::date),
            ($1, 500.00, 'expense_misc', $4::date)`,
    [userId, start, end, outOfPeriod],
  );

  const breakdown = await categoryBreakdown(client, userId, start, end);
  const totals = await periodTotals(client, userId, start, end);

  console.log("1) Category sums equal period totals");
  assertEq("income breakdown sum", sumBreakdown(breakdown.income), totals.income);
  assertEq("expense breakdown sum", sumBreakdown(breakdown.expense), totals.expense);
  assertEq("period income", totals.income, "175.00");
  assertEq("period expense", totals.expense, "100.00");
  console.log("");

  console.log("2) Per-category amounts match manual expectations");
  const incMap = Object.fromEntries(breakdown.income.map((r) => [r.category, r]));
  assertEq("storefront amount (100+25 legacy)", incMap.storefront?.amount ?? "missing", "125.00");
  assertEq("storefront count", String(incMap.storefront?.count ?? "missing"), "2");
  assertEq("delivery amount", incMap.delivery?.amount ?? "missing", "50.00");
  assertEq("delivery count", String(incMap.delivery?.count ?? "missing"), "1");
  const expMap = Object.fromEntries(breakdown.expense.map((r) => [r.category, r]));
  assertEq("materials amount", expMap.materials?.amount ?? "missing", "80.00");
  assertEq("rent amount", expMap.rent?.amount ?? "missing", "20.00");
  assertEq("expense_misc absent (out of period)", expMap.expense_misc ? "present" : "absent", "absent");
  console.log("");

  console.log("3) Out-of-period entry excluded from totals");
  assertEq("income excludes 999", totals.income, "175.00");
  assertEq("expense excludes 500", totals.expense, "100.00");
  console.log("");

  console.log("4) Booth entries never in regular breakdown");
  const boothInBreakdown = breakdown.income.some((r) => toCents(r.amount) >= toCents("7777"));
  assertEq("no booth 7777 in breakdown", boothInBreakdown ? "leaked" : "isolated", "isolated");
  console.log("");

  console.log("5) API GET /api/summary/categories?period=last_7");
  const base = await detectBase();
  const last7Totals = await periodTotals(client, userId, last7.start, last7.end);
  if (!base) {
    console.log("  (skipped — dev server not running)");
  } else {
    const res = await fetch(`${base}/api/summary/categories?period=last_7`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    assertEq("API status", String(res.status), "200");
    const apiInc = sumBreakdown(body.data?.income ?? []);
    assertEq("API income sum matches last_7 totals", apiInc, last7Totals.income);
    assertEq("API expense sum matches last_7 totals", sumBreakdown(body.data?.expense ?? []), last7Totals.expense);
  }
  console.log("");

  console.log("6) Stats page renders breakdown section (regular mode)");
  if (base) {
    const page = await fetch(`${base}/summary?period=last_7`, { headers: { Cookie: cookie } });
    const html = await page.text();
    assertEq("stats 200", String(page.status), "200");
    assertEq("has รายรับตามหมวด", html.includes("รายรับตามหมวด") ? "yes" : "no", "yes");
    assertEq("has รายจ่ายตามหมวด", html.includes("รายจ่ายตามหมวด") ? "yes" : "no", "yes");
    for (const c of INCOME_CATEGORIES) {
      if (c.key === "storefront" || c.key === "delivery") {
        assertEq(`has income ${c.label}`, html.includes(c.label) ? "yes" : "no", "yes");
      }
    }
    for (const c of EXPENSE_CATEGORIES) {
      if (c.key === "materials" || c.key === "rent") {
        assertEq(`has expense ${c.label}`, html.includes(c.label) ? "yes" : "no", "yes");
      }
    }
  } else {
    console.log("  (skipped — dev server not running)");
  }
  console.log("");

  if (failed === 0) console.log("All assertions passed.");
  else {
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
