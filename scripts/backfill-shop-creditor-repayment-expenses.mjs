/**
 * Backfill expense_entries for shop creditor_repayments made before expense logging.
 * Run after deploying creditor repayment → expense_entries flow:
 *   node scripts/backfill-shop-creditor-repayment-expenses.mjs
 */
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, user_id, payer_name, amount, payment_method, note, entry_date::text AS entry_date
       FROM creditor_repayments
       WHERE booth_id IS NULL
       ORDER BY entry_date, created_at`,
    );

    let inserted = 0;
    for (const r of rows) {
      const note = r.note?.trim()
        ? `จ่ายคืน ${r.payer_name} · ${r.note.trim()}`
        : `จ่ายคืน ${r.payer_name}`;

      const { rows: existing } = await client.query(
        `SELECT 1 FROM expense_entries
         WHERE user_id = $1 AND entry_date = $2::date AND amount = $3
           AND note = $4 AND payment_method = $5
         LIMIT 1`,
        [r.user_id, r.entry_date, r.amount, note, r.payment_method],
      );
      if (existing.length > 0) continue;

      await client.query(
        `INSERT INTO expense_entries (user_id, amount, category, payment_method, note, entry_date)
         VALUES ($1, $2, 'expense_misc', $3, $4, $5::date)`,
        [r.user_id, r.amount, r.payment_method, note, r.entry_date],
      );
      inserted++;
    }
    console.log(`Backfill complete: ${inserted} expense rows inserted`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
