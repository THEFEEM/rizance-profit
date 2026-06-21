// Fix Pack I — savings transactions excluded from operating summary + goal balance.
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // optional
  }
}

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function computeProfit(income, expense) {
  return ((toCents(income) - toCents(expense)) / 100).toFixed(2);
}

function assertTrue(label, cond) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

/** Pure: operating summary excludes savings flags from totals. */
function operatingSummary(rows) {
  let income = 0;
  let expense = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  for (const r of rows) {
    const cents = toCents(r.amount);
    if (r.kind === "income") {
      totalIncome += cents;
      if (!r.is_savings_withdrawal) income += cents;
    } else {
      totalExpense += cents;
      if (!r.is_savings_deposit) expense += cents;
    }
  }
  return {
    income: (income / 100).toFixed(2),
    expense: (expense / 100).toFixed(2),
    wallet: computeProfit(String(totalIncome / 100), String(totalExpense / 100)),
    operating: computeProfit(String(income / 100), String(expense / 100)),
  };
}

function goalBalance(deposits, withdrawals) {
  const d = deposits.reduce((s, a) => s + toCents(a), 0);
  const w = withdrawals.reduce((s, a) => s + toCents(a), 0);
  return Math.max(0, d - w) / 100;
}

console.log("=== FIX PACK I LOGIC TEST ===\n");

const sample = [
  { kind: "income", amount: "10000.00", is_savings_withdrawal: false },
  { kind: "expense", amount: "3000.00", is_savings_deposit: false },
  { kind: "expense", amount: "2000.00", is_savings_deposit: true },
  { kind: "income", amount: "500.00", is_savings_withdrawal: true },
];

const s = operatingSummary(sample);
assertTrue("operating income excludes savings withdrawal", s.income === "10000.00");
assertTrue("operating expense excludes savings deposit", s.expense === "3000.00");
assertTrue("operating balance 7000", s.operating === "7000.00");
assertTrue("wallet balance 5500 (all moves)", s.wallet === "5500.00");

const bal = goalBalance(["2000.00", "1000.00"], ["500.00"]);
assertTrue("goal balance = deposits − withdrawals", bal === 2500);

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.log("\n⊘ DB tests skipped (DATABASE_URL not set)");
} else {
  const client = new pg.Client(pgClientOptions(cs));
  try {
    await client.connect();

    const col = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'personal_expense_entries' AND column_name = 'is_savings_deposit'`,
    );
    if (col.rows.length === 0) {
      console.log("\n⊘ DB integration skipped (migration 0020 not applied)");
    } else {
      const email = `fix-pack-i-${Date.now()}@rizance.test`;
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, shop_name)
         VALUES ($1, 'x', 'Pack I Test') RETURNING id`,
        [email],
      );
      const userId = userRes.rows[0].id;

      const goalRes = await client.query(
        `INSERT INTO savings_goals (user_id, name, target_amount, current_amount)
         VALUES ($1, 'Emergency', 10000, 0) RETURNING id`,
        [userId],
      );
      const goalId = goalRes.rows[0].id;

      await client.query(
        `INSERT INTO personal_income_entries (user_id, amount, category, entry_date)
         VALUES ($1, 5000, 'salary', CURRENT_DATE)`,
        [userId],
      );
      await client.query(
        `INSERT INTO personal_expense_entries
           (user_id, amount, category, entry_date, is_savings_deposit, savings_goal_id)
         VALUES ($1, 1000, 'savings_deposit', CURRENT_DATE, true, $2)`,
        [userId, goalId],
      );

      const sum = await client.query(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM personal_income_entries
             WHERE user_id = $1 AND COALESCE(is_savings_withdrawal, false) = false), 0)::text AS income,
           COALESCE((SELECT SUM(amount) FROM personal_expense_entries
             WHERE user_id = $1 AND COALESCE(is_savings_deposit, false) = false), 0)::text AS expense,
           COALESCE((SELECT SUM(amount) FROM personal_income_entries WHERE user_id = $1), 0)::text AS total_income,
           COALESCE((SELECT SUM(amount) FROM personal_expense_entries WHERE user_id = $1), 0)::text AS total_expense`,
        [userId],
      );
      const r = sum.rows[0];
      assertTrue("DB operating income 5000", r.income === "5000.00");
      assertTrue("DB operating expense 0", r.expense === "0.00");
      assertTrue("DB wallet 4000", computeProfit(r.total_income, r.total_expense) === "4000.00");

      await client.query(
        `UPDATE savings_goals SET current_amount = (
           COALESCE((SELECT SUM(amount) FROM personal_expense_entries
             WHERE user_id = $1 AND savings_goal_id = $2 AND is_savings_deposit = true), 0)
           - COALESCE((SELECT SUM(amount) FROM personal_income_entries
             WHERE user_id = $1 AND savings_goal_id = $2 AND is_savings_withdrawal = true), 0)
         ) WHERE id = $2`,
        [userId, goalId],
      );
      const goal = await client.query(`SELECT current_amount::text AS a FROM savings_goals WHERE id = $1`, [
        goalId,
      ]);
      assertTrue("DB goal current_amount 1000", goal.rows[0].a === "1000.00");

      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("\n✓ DB integration passed");
    }
  } catch (err) {
    console.error("\n✗ DB test failed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.exitCode) {
  console.log("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll assertions passed.");
