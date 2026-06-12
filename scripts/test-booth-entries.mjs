// Booth entry end-to-end test via HTTP API (requires dev server).
// Exercises guardBoothEntry mapping, boothSummary buckets, and profit derivation.
// Usage: npm run dev (terminal 1), then npm run test:booth-entries (terminal 2)
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

function sumDecimals(...values) {
  const total = values.reduce((acc, v) => acc + toCents(v), 0);
  return (total / 100).toFixed(2);
}

/** Mirrors lib/money.ts computeProfit */
function computeProfit(income, expense) {
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

/** Mirrors lib/booth-queries.ts boothSummary SQL + profit */
async function boothSummary(client, boothId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed_expense,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable_expense,
       (SELECT pool_budget::text FROM booths WHERE id = $1) AS pool_budget`,
    [boothId],
  );
  const r = rows[0];
  const totalIncome = sumDecimals(r.cash_income, r.transfer_income);
  const totalExpense = sumDecimals(r.fixed_expense, r.variable_expense);
  return {
    cashIncome: r.cash_income,
    transferIncome: r.transfer_income,
    totalIncome,
    fixedExpense: r.fixed_expense,
    variableExpense: r.variable_expense,
    totalExpense,
    profit: computeProfit(totalIncome, totalExpense),
    poolBudget: r.pool_budget,
  };
}

async function countEntries(client, boothId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM booth_income_entries WHERE booth_id = $1) AS income,
       (SELECT COUNT(*)::int FROM booth_expense_entries WHERE booth_id = $1) AS expense`,
    [boothId],
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
  const bases = [];
  if (process.env.SMOKE_BASE_URL) bases.push(process.env.SMOKE_BASE_URL);
  for (const port of [3002, 3001, 3000, 3003]) bases.push(`http://localhost:${port}`);
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/api/booths`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200) return base;
    } catch {
      // try next
    }
  }
  return null;
}

async function apiPost(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no json
  }
  return { status: res.status, json };
}

let failed = 0;

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`      expected: ${expected}`);
  console.log(`      actual:   ${actual}`);
  if (!ok) failed++;
  return ok;
}

function assertOk(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
const userIds = [];

try {
  await client.connect();
  console.log("=== BOOTH ENTRY E2E TEST (API + boothSummary) ===\n");

  const email = `booth-e2e-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'booth-e2e-test', 'E2E Booth Test') RETURNING id`,
    [email],
  );
  const userId = users[0].id;
  userIds.push(userId);
  await makeSessionCookie(userId);

  const base = await detectBase();
  if (!base) {
    throw new Error("Dev server not detected — run: npm run dev");
  }
  console.log(`API base: ${base}\n`);

  const startDate = "2026-06-09";
  const endDate = "2026-06-11";
  const midDate = "2026-06-10";

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งาน E2E', 1000.00, $2::date, $3::date)
     RETURNING id`,
    [userId, startDate, endDate],
  );
  const boothId = booths[0].id;

  // (a) Income split
  console.log("(a) Income split: cash ฿100 + transfer ฿50");
  let res = await apiPost(base, `/api/booths/${boothId}/income`, {
    amount: 100,
    paymentMethod: "cash",
    entryDate: midDate,
  });
  assertOk("POST cash ฿100 → 201", res.status === 201, `got ${res.status}`);
  res = await apiPost(base, `/api/booths/${boothId}/income`, {
    amount: 50,
    paymentMethod: "transfer",
    entryDate: midDate,
  });
  assertOk("POST transfer ฿50 → 201", res.status === 201, `got ${res.status}`);

  let summary = await boothSummary(client, boothId);
  assertEq("(a) cashIncome", summary.cashIncome, "100.00");
  assertEq("(a) transferIncome", summary.transferIncome, "50.00");
  assertEq("(a) totalIncome", summary.totalIncome, "150.00");
  console.log("");

  // (b) Expense split
  console.log("(b) Expense split: fixed ฿80 + variable ฿20");
  res = await apiPost(base, `/api/booths/${boothId}/expense`, {
    amount: 80,
    costType: "fixed",
    label: "ค่าที่",
    entryDate: midDate,
  });
  assertOk("POST fixed ฿80 → 201", res.status === 201, `got ${res.status}`);
  res = await apiPost(base, `/api/booths/${boothId}/expense`, {
    amount: 20,
    costType: "variable",
    label: "นม",
    entryDate: midDate,
  });
  assertOk("POST variable ฿20 → 201", res.status === 201, `got ${res.status}`);

  summary = await boothSummary(client, boothId);
  assertEq("(b) fixedExpense", summary.fixedExpense, "80.00");
  assertEq("(b) variableExpense", summary.variableExpense, "20.00");
  assertEq("(b) totalExpense", summary.totalExpense, "100.00");
  console.log("");

  // (c) Profit = income − expense (budget NOT subtracted)
  console.log("(c) Profit = totalIncome − totalExpense (budget excluded)");
  summary = await boothSummary(client, boothId);
  assertEq("(c) profit", summary.profit, "50.00");
  assertEq("(c) poolBudget unchanged (not in profit)", summary.poolBudget, "1000.00");
  assertOk(
    "(c) profit is NOT poolBudget − expense",
    summary.profit !== computeProfit(summary.poolBudget, summary.totalExpense),
    `profit=${summary.profit}`,
  );
  console.log("");

  // (d) date_out_of_range — no rows inserted
  console.log("(d) GUARD date_out_of_range → 422, no insert");
  const before = await countEntries(client, boothId);
  res = await apiPost(base, `/api/booths/${boothId}/income`, {
    amount: 99,
    paymentMethod: "cash",
    entryDate: "2026-06-08",
  });
  assertEq("(d) before start_date HTTP status", String(res.status), "422");
  assertEq("(d) before start_date reason", res.json?.error?.reason ?? "missing", "date_out_of_range");
  const afterBefore = await countEntries(client, boothId);
  assertEq("(d) income row count unchanged (before)", String(afterBefore.income), String(before.income));

  res = await apiPost(base, `/api/booths/${boothId}/income`, {
    amount: 99,
    paymentMethod: "transfer",
    entryDate: "2026-06-12",
  });
  assertEq("(d) after end_date HTTP status", String(res.status), "422");
  assertEq("(d) after end_date reason", res.json?.error?.reason ?? "missing", "date_out_of_range");
  const afterAfter = await countEntries(client, boothId);
  assertEq("(d) income row count unchanged (after)", String(afterAfter.income), String(before.income));
  console.log("");

  // (e) booth_closed — income + expense both 409
  console.log("(e) GUARD booth_closed → 409 after close");
  await client.query(
    `UPDATE booths SET status = 'closed', closed_at = now() WHERE id = $1`,
    [boothId],
  );
  res = await apiPost(base, `/api/booths/${boothId}/income`, {
    amount: 10,
    paymentMethod: "cash",
    entryDate: midDate,
  });
  assertEq("(e) closed booth income HTTP status", String(res.status), "409");
  assertEq("(e) closed booth income reason", res.json?.error?.reason ?? "missing", "booth_closed");

  res = await apiPost(base, `/api/booths/${boothId}/expense`, {
    amount: 10,
    costType: "fixed",
    entryDate: midDate,
  });
  assertEq("(e) closed booth expense HTTP status", String(res.status), "409");
  assertEq("(e) closed booth expense reason", res.json?.error?.reason ?? "missing", "booth_closed");
  console.log("");

  // (f) booth_not_found — other user's booth → 404
  console.log("(f) GUARD booth_not_found → 404 (user_id scoping)");
  const { rows: otherUsers } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'other-user', 'Other Shop') RETURNING id`,
    [`booth-other-${Date.now()}@rizance.test`],
  );
  const otherUserId = otherUsers[0].id;
  userIds.push(otherUserId);

  const { rows: otherBooths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งานคนอื่น', 200.00, $2::date, $3::date) RETURNING id`,
    [otherUserId, startDate, endDate],
  );
  const otherBoothId = otherBooths[0].id;

  res = await apiPost(base, `/api/booths/${otherBoothId}/income`, {
    amount: 10,
    paymentMethod: "cash",
    entryDate: midDate,
  });
  assertEq("(f) other-user booth income HTTP status", String(res.status), "404");
  assertEq("(f) other-user booth income reason", res.json?.error?.reason ?? "missing", "booth_not_found");

  const fakeId = "00000000-0000-4000-8000-000000000099";
  res = await apiPost(base, `/api/booths/${fakeId}/income`, {
    amount: 10,
    paymentMethod: "cash",
    entryDate: midDate,
  });
  assertEq("(f) random booth id HTTP status", String(res.status), "404");
  assertEq("(f) random booth id reason", res.json?.error?.reason ?? "missing", "booth_not_found");
  console.log("");

  // (g) Boundary inclusive: start_date and end_date both succeed
  console.log("(g) Boundary inclusive: entries on start_date and end_date");
  const { rows: boundaryBooths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งานขอบเขต', 500.00, $2::date, $3::date) RETURNING id`,
    [userId, startDate, endDate],
  );
  const boundaryBoothId = boundaryBooths[0].id;

  res = await apiPost(base, `/api/booths/${boundaryBoothId}/income`, {
    amount: 1,
    paymentMethod: "cash",
    entryDate: startDate,
  });
  assertEq("(g) income on start_date HTTP status", String(res.status), "201");

  res = await apiPost(base, `/api/booths/${boundaryBoothId}/income`, {
    amount: 2,
    paymentMethod: "transfer",
    entryDate: endDate,
  });
  assertEq("(g) income on end_date HTTP status", String(res.status), "201");

  const { rows: boundaryRows } = await client.query(
    `SELECT entry_date::text AS entry_date FROM booth_income_entries
     WHERE booth_id = $1 ORDER BY entry_date`,
    [boundaryBoothId],
  );
  assertEq("(g) rows on start_date", boundaryRows[0]?.entry_date ?? "missing", startDate);
  assertEq("(g) rows on end_date", boundaryRows[1]?.entry_date ?? "missing", endDate);
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
  for (const id of userIds) {
    await client.query(`DELETE FROM users WHERE id = $1`, [id]);
  }
  if (userIds.length) {
    console.log(`(cleaned up ${userIds.length} test user(s) — CASCADE)`);
  }
  await client.end();
}
