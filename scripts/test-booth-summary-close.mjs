// Booth summary math + close permanence test.
// Usage: npm run dev (optional for HTTP), then npm run test:booth-summary-close
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
  return (values.reduce((acc, v) => acc + toCents(v), 0) / 100).toFixed(2);
}

function computeProfit(income, expense) {
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

/** Mirrors lib/booth-queries.ts boothSummary */
async function boothSummary(client, userId, boothId) {
  const { rows: boothRows } = await client.query(
    `SELECT pool_budget::text AS pool_budget, status
     FROM booths WHERE user_id = $1 AND id = $2`,
    [userId, boothId],
  );
  if (!boothRows[0]) return null;

  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed_expense,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable_expense`,
    [boothId],
  );
  const r = rows[0];
  const totalIncome = sumDecimals(r.cash_income, r.transfer_income);
  const totalExpense = sumDecimals(r.fixed_expense, r.variable_expense);
  return {
    poolBudget: boothRows[0].pool_budget,
    status: boothRows[0].status,
    cashIncome: r.cash_income,
    transferIncome: r.transfer_income,
    totalIncome,
    fixedExpense: r.fixed_expense,
    variableExpense: r.variable_expense,
    totalExpense,
    profit: computeProfit(totalIncome, totalExpense),
  };
}

/** Mirrors closeBooth in lib/booth-queries.ts */
async function closeBooth(client, userId, boothId) {
  const { rows: existing } = await client.query(
    `SELECT status FROM booths WHERE user_id = $1 AND id = $2`,
    [userId, boothId],
  );
  if (!existing[0]) return { ok: false, reason: "booth_not_found" };
  if (existing[0].status === "closed") return { ok: false, reason: "already_closed" };

  const { rows } = await client.query(
    `UPDATE booths SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = 'open'
     RETURNING status`,
    [userId, boothId],
  );
  if (!rows[0]) return { ok: false, reason: "already_closed" };
  return { ok: true };
}

/** Mirrors updateBooth closed guard */
async function updateBoothGuard(client, userId, boothId) {
  const { rows } = await client.query(
    `SELECT status FROM booths WHERE user_id = $1 AND id = $2`,
    [userId, boothId],
  );
  if (!rows[0]) return { ok: false, reason: "booth_not_found" };
  if (rows[0].status === "closed") return { ok: false, reason: "booth_closed" };
  return { ok: true };
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
    body: body === undefined ? undefined : JSON.stringify(body),
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
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== BOOTH SUMMARY + CLOSE TEST ===\n");

  const email = `booth-close-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'booth-close-test', 'Close Test') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  const date = "2026-06-10";
  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งานสรุป', 5000.00, '2026-06-09'::date, '2026-06-11'::date)
     RETURNING id`,
    [userId],
  );
  const boothId = booths[0].id;

  // 1) boothSummary math
  console.log("1) boothSummary math (budget separate, profit = income − expense)");
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 100.00, 'cash', $3::date), ($1, $2, 50.00, 'transfer', $3::date)`,
    [boothId, userId, date],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, category, entry_date)
     VALUES ($1, $2, 80.00, 'fixed', 'rent', $3::date), ($1, $2, 20.00, 'variable', 'materials', $3::date)`,
    [boothId, userId, date],
  );

  const sum = await boothSummary(client, userId, boothId);
  assertEq("cashIncome", sum.cashIncome, "100.00");
  assertEq("transferIncome", sum.transferIncome, "50.00");
  assertEq("totalIncome", sum.totalIncome, "150.00");
  assertEq("fixedExpense", sum.fixedExpense, "80.00");
  assertEq("variableExpense", sum.variableExpense, "20.00");
  assertEq("totalExpense", sum.totalExpense, "100.00");
  assertEq("profit", sum.profit, "50.00");
  assertEq("poolBudget (display only)", sum.poolBudget, "5000.00");

  await client.query(
    `INSERT INTO booth_members (booth_id, name, role, investment_amount)
     VALUES ($1, 'Inv', 'investor', 2000.00)`,
    [boothId],
  );
  const { rows: budgetRow } = await client.query(
    `SELECT pool_budget::text AS pool_budget,
       COALESCE((SELECT SUM(investment_amount) FROM booth_members
                 WHERE booth_id = $1 AND role IN ('investor','manager')), 0)::text AS member_equity
     FROM booths WHERE id = $1`,
    [boothId],
  );
  const totalBudget = sumDecimals(budgetRow[0].pool_budget, budgetRow[0].member_equity);
  assertEq("totalBudget = pool + member equity", totalBudget, "7000.00");

  const budgetMinusExpense = computeProfit(sum.poolBudget, sum.totalExpense);
  assertEq(
    "profit NOT budget − expense",
    sum.profit === "50.00" && budgetMinusExpense !== "50.00" ? "confirmed" : `profit=${sum.profit}, budget−exp=${budgetMinusExpense}`,
    "confirmed",
  );
  console.log("");

  // 2) close + double-close + reopen guard
  console.log("2) close permanence");
  const first = await closeBooth(client, userId, boothId);
  assertEq("first close ok", String(first.ok), "true");

  const { rows: afterClose } = await client.query(
    `SELECT status, closed_at IS NOT NULL AS has_closed_at FROM booths WHERE id = $1`,
    [boothId],
  );
  assertEq("status after close", afterClose[0].status, "closed");
  assertEq("closed_at set", String(afterClose[0].has_closed_at), "true");

  const second = await closeBooth(client, userId, boothId);
  assertEq("double-close reason", second.reason ?? "missing", "already_closed");

  const reopen = await updateBoothGuard(client, userId, boothId);
  assertEq("reopen via updateBooth guard", reopen.reason ?? "missing", "booth_closed");
  console.log("");

  // 3) HTTP close + double-close + entry guard (Step 3 holds)
  console.log("3) HTTP close API + closed entry rejection");
  const base = await detectBase();
  if (!base) {
    console.log("  (skip HTTP — no dev server)");
  } else {
    console.log(`  using ${base}`);

    const { rows: openBooths } = await client.query(
      `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
       VALUES ($1, 'งาน HTTP', 1000.00, '2026-06-09'::date, '2026-06-11'::date) RETURNING id`,
      [userId],
    );
    const httpBoothId = openBooths[0].id;

    let res = await apiPost(base, `/api/booths/${httpBoothId}/close`);
    assertEq("POST close → 200", String(res.status), "200");
    assertEq("close response status", res.json?.data?.status ?? "missing", "closed");

    res = await apiPost(base, `/api/booths/${httpBoothId}/close`);
    assertEq("double-close HTTP status", String(res.status), "409");
    assertEq("double-close reason", res.json?.error?.reason ?? "missing", "already_closed");

    res = await apiPost(base, `/api/booths/${httpBoothId}/income`, {
      amount: 10,
      paymentMethod: "cash",
      entryDate: date,
    });
    assertEq("closed income POST", String(res.status), "409");
    assertEq("closed income reason", res.json?.error?.reason ?? "missing", "booth_closed");

    res = await apiPost(base, `/api/booths/${httpBoothId}/expense`, {
      amount: 10,
      costType: "fixed",
      entryDate: date,
    });
    assertEq("closed expense POST", String(res.status), "409");
    assertEq("closed expense reason", res.json?.error?.reason ?? "missing", "booth_closed");
  }
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
