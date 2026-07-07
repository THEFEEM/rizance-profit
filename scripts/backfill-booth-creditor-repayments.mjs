/**
 * One-time backfill: snapshot auto-FIFO advance repayments into creditor_repayments
 * before switching booth split to manual creditor repayment.
 *
 * Run after migration 0036, before deploying new split logic:
 *   node scripts/backfill-booth-creditor-repayments.mjs
 */
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Inline minimal FIFO (matches lib/booth-split computeAdvanceRepayments)
function toCents(v) {
  return Math.round(Number(v) * 100);
}
function centsToDecimal(c) {
  return (c / 100).toFixed(2);
}
function computeAdvanceRepayments(grossProfit, advances) {
  const grossCents = toCents(grossProfit);
  if (grossCents <= 0 || advances.length === 0) return [];
  const sorted = [...advances].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  let remaining = grossCents;
  const paid = new Map();
  for (const adv of sorted) {
    if (remaining <= 0) break;
    const pay = Math.min(remaining, toCents(adv.amount));
    if (pay <= 0) continue;
    const key = adv.creditor_name;
    paid.set(key, (paid.get(key) ?? 0) + pay);
    remaining -= pay;
  }
  return [...paid.entries()].map(([name, cents]) => ({ name, amount: centsToDecimal(cents) }));
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows: booths } = await client.query(
      `SELECT b.id AS booth_id, b.user_id, b.start_date::text, b.end_date::text,
              COALESCE(SUM(i.amount), 0)::text AS income,
              COALESCE(SUM(e.amount), 0)::text AS expense
       FROM booths b
       LEFT JOIN booth_income_entries i ON i.booth_id = b.id
       LEFT JOIN booth_expense_entries e ON e.booth_id = b.id
       GROUP BY b.id`,
    );

    let inserted = 0;
    for (const booth of booths) {
      const { rows: existing } = await client.query(
        `SELECT 1 FROM creditor_repayments WHERE booth_id = $1 LIMIT 1`,
        [booth.booth_id],
      );
      if (existing.length > 0) continue;

      const { rows: advances } = await client.query(
        `SELECT creditor_name, amount, entry_date::text AS entry_date FROM (
           SELECT m.name AS creditor_name, e.amount, e.entry_date
           FROM booth_expense_entries e
           JOIN booth_members m ON m.id = e.payer_member_id
           WHERE e.booth_id = $1
           UNION ALL
           SELECT NULLIF(btrim(e.external_payer_name), '') AS creditor_name,
                  e.amount, e.entry_date
           FROM booth_expense_entries e
           WHERE e.booth_id = $1
             AND NULLIF(btrim(e.external_payer_name), '') IS NOT NULL
         ) x`,
        [booth.booth_id],
      );
      if (advances.length === 0) continue;

      const grossCents = toCents(booth.income) - toCents(booth.expense);
      const repayments = computeAdvanceRepayments(centsToDecimal(grossCents), advances);
      if (repayments.length === 0) continue;

      await client.query("BEGIN");
      for (const r of repayments) {
        await client.query(
          `INSERT INTO creditor_repayments
             (user_id, booth_id, payer_kind, payer_name, amount, payment_method, note, entry_date)
           VALUES ($1, $2, 'external', $3, $4, 'cash', 'ยอดยกมา (auto-FIFO)', CURRENT_DATE)`,
          [booth.user_id, booth.booth_id, r.name, r.amount],
        );
        inserted++;
      }
      await client.query("COMMIT");
    }
    console.log(`Backfill complete: ${inserted} repayment rows inserted`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
