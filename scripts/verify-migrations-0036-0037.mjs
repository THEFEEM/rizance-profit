/**
 * Verify migrations 0036 + 0037 against DATABASE_URL (production or local).
 *
 * Usage:
 *   node scripts/verify-migrations-0036-0037.mjs
 *   npm run verify:migrations-0036-0037
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // optional
  }
}

const CHECKS = [
  {
    id: "0036 booth_id column",
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'creditor_repayments'
        AND column_name = 'booth_id'
        AND udt_name = 'uuid'
        AND is_nullable = 'YES'
    ) AS ok`,
  },
  {
    id: "0036 booth_id FK → booths",
    sql: `SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'creditor_repayments'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'booth_id'
        AND ccu.table_name = 'booths'
    ) AS ok`,
  },
  {
    id: "0036 idx_creditor_repayments_booth",
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'creditor_repayments'
        AND indexname = 'idx_creditor_repayments_booth'
    ) AS ok`,
  },
  {
    id: "0037 payment_method column",
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'booth_expense_entries'
        AND column_name = 'payment_method'
        AND is_nullable = 'NO'
        AND column_default LIKE '%cash%'
    ) AS ok`,
  },
  {
    id: "0037 payment_method CHECK",
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'booth_expense_entries'
        AND c.conname = 'booth_expense_entries_payment_method_check'
    ) AS ok`,
  },
  {
    id: "0028 creditor_repayments.payment_method (reused)",
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'creditor_repayments'
        AND column_name = 'payment_method'
        AND is_nullable = 'NO'
    ) AS ok`,
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = new pg.Client(pgClientOptions(connectionString));
  await client.connect();

  console.log("=== verify migrations 0036 + 0037 ===\n");

  let failed = 0;
  for (const check of CHECKS) {
    const { rows } = await client.query(check.sql);
    const ok = rows[0]?.ok === true;
    console.log(`${ok ? "✓" : "✗"} ${check.id}`);
    if (!ok) failed += 1;
  }

  const repayCounts = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE booth_id IS NOT NULL)::int AS booth_repayments,
      COUNT(*) FILTER (WHERE booth_id IS NULL)::int AS shop_repayments,
      COUNT(*)::int AS total
    FROM creditor_repayments
  `);
  console.log("\n— creditor_repayments —");
  console.log(repayCounts.rows[0]);

  try {
    const expenseCounts = await client.query(`
      SELECT payment_method, COUNT(*)::int AS rows
      FROM booth_expense_entries
      GROUP BY payment_method
      ORDER BY payment_method
    `);
    console.log("\n— booth_expense_entries by payment_method —");
    for (const row of expenseCounts.rows) {
      console.log(`  ${row.payment_method}: ${row.rows}`);
    }
  } catch (err) {
    console.log("\n— booth_expense_entries —");
    console.log("  (skipped:", err.message, ")");
  }

  await client.end();

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
