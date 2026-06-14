// Read-only pre-migration row counts for category system Round 1.
// Usage: node scripts/category-migration-counts.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(root, file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client(pgClientOptions(connectionString));

async function countGroup(table, groupCol, where = "TRUE") {
  const { rows } = await client.query(
    `SELECT ${groupCol} AS key, COUNT(*)::int AS n FROM ${table} WHERE ${where} GROUP BY ${groupCol} ORDER BY n DESC`,
  );
  return rows;
}

async function scalar(sql) {
  const { rows } = await client.query(sql);
  return rows[0];
}

try {
  await client.connect();
  console.log("=== CATEGORY MIGRATION — PRE-FLIGHT ROW COUNTS (read-only) ===\n");

  const incomeTotal = await scalar("SELECT COUNT(*)::int AS n FROM income_entries");
  console.log(`income_entries total: ${incomeTotal.n}`);
  for (const r of await countGroup("income_entries", "category")) {
    console.log(`  category=${r.key}: ${r.n}`);
  }
  const incomeOther = await scalar(
    "SELECT COUNT(*)::int AS n FROM income_entries WHERE category = 'other'",
  );
  console.log(`  → would map other → other_income: ${incomeOther.n} rows\n`);

  const expenseTotal = await scalar("SELECT COUNT(*)::int AS n FROM expense_entries");
  console.log(`expense_entries total: ${expenseTotal.n}`);
  for (const r of await countGroup("expense_entries", "category")) {
    console.log(`  category=${r.key}: ${r.n}`);
  }
  console.log("  proposed shop expense remap:");
  const expenseMaps = [
    ["supplies", "materials"],
    ["salary", "wage"],
    ["other", "expense_misc"],
    ["rent", "rent (unchanged)"],
    ["utilities", "utilities (unchanged)"],
    ["equipment", "equipment (unchanged)"],
  ];
  for (const [from, to] of expenseMaps) {
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM expense_entries WHERE category = $1`,
      [from],
    );
    console.log(`    ${from} → ${to}: ${res.rows[0].n}`);
  }
  console.log();

  const boothIncomeTotal = await scalar("SELECT COUNT(*)::int AS n FROM booth_income_entries");
  console.log(`booth_income_entries total: ${boothIncomeTotal.n}`);
  for (const r of await countGroup("booth_income_entries", "payment_method")) {
    console.log(`  payment_method=${r.key}: ${r.n}`);
  }
  const hasBoothIncomeCat = await scalar(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'booth_income_entries' AND column_name = 'category'
  `);
  console.log(`  category column exists: ${hasBoothIncomeCat.n > 0 ? "yes" : "no"}`);
  console.log(`  → new category default proposal: storefront for all ${boothIncomeTotal.n} rows\n`);

  const boothExpenseTotal = await scalar("SELECT COUNT(*)::int AS n FROM booth_expense_entries");
  console.log(`booth_expense_entries total: ${boothExpenseTotal.n}`);
  for (const r of await countGroup("booth_expense_entries", "cost_type")) {
    console.log(`  cost_type=${r.key}: ${r.n}`);
  }
  const hasBoothExpenseCat = await scalar(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'booth_expense_entries' AND column_name = 'category'
  `);
  console.log(`  category column exists: ${hasBoothExpenseCat.n > 0 ? "yes" : "no"}`);
  console.log("  label hints (top per cost_type):");
  for (const ct of ["fixed", "variable"]) {
    const labels = await client.query(
      `SELECT COALESCE(NULLIF(TRIM(label), ''), '(blank)') AS label, COUNT(*)::int AS n
       FROM booth_expense_entries WHERE cost_type = $1
       GROUP BY 1 ORDER BY n DESC LIMIT 5`,
      [ct],
    );
    for (const row of labels.rows) {
      console.log(`    ${ct} / ${row.label}: ${row.n}`);
    }
  }
  console.log("  ⚠ booth expense category backfill — AWAITING YOUR MAPPING APPROVAL\n");

  const incomePm = await scalar(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'income_entries' AND column_name = 'payment_method'
  `);
  console.log(`income_entries payment_method column exists: ${incomePm.n > 0 ? "yes" : "no"}`);
  if (incomePm.n > 0) {
    for (const r of await countGroup("income_entries", "payment_method")) {
      console.log(`  payment_method=${r.key}: ${r.n}`);
    }
  } else {
    console.log(`  → would add payment_method default cash for ${incomeTotal.n} rows`);
  }

  console.log("=== POST-MIGRATION VERIFY ===\n");
  for (const r of await countGroup("booth_expense_entries", "category")) {
    console.log(`  booth_expense category=${r.key}: ${r.n}`);
  }
  const nullBooth = await scalar(
    "SELECT COUNT(*)::int AS n FROM booth_expense_entries WHERE category IS NULL",
  );
  console.log(`  booth_expense NULL category: ${nullBooth.n} (expect 0)\n`);
} catch (err) {
  console.error("Count failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
