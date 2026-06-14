// Informational crosscheck: compare isFixed(category) vs legacy cost_type on booth expenses.
// Mismatches are reported, not hard-failed — some are intentional B+ corrections (e.g. น้ำมัน).
// Usage: node scripts/test-category-costtype-crosscheck.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { isFixed } from "./expense-categories-core.mjs";

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

/** B+ intentional corrections — legacy cost_type kept; category is source of truth. */
function isKnownCorrection(row) {
  const label = row.label?.trim() ?? "";
  return row.cost_type === "fixed" && row.category === "expense_misc" && label.includes("น้ำมัน");
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));

try {
  await client.connect();
  console.log("=== CATEGORY vs COST_TYPE CROSSCHECK (informational) ===\n");

  const { rows } = await client.query(
    `SELECT id, booth_id, amount, cost_type, category, label, entry_date::text AS entry_date
     FROM booth_expense_entries
     ORDER BY entry_date, id`,
  );

  const mismatches = [];
  for (const row of rows) {
    const fromCategory = isFixed(row.category);
    const fromCostType = row.cost_type === "fixed";
    if (fromCategory !== fromCostType) mismatches.push(row);
  }

  const known = mismatches.filter(isKnownCorrection);
  const other = mismatches.filter((row) => !isKnownCorrection(row));

  console.log(`Rows checked: ${rows.length}`);
  console.log(`Mismatches: ${mismatches.length} (${known.length} known correction, ${other.length} other)\n`);

  if (mismatches.length === 0) {
    console.log("✓ All rows agree — isFixed(category) matches cost_type.");
  } else {
    for (const m of mismatches) {
      const tag = isKnownCorrection(m) ? " [known correction]" : "";
      console.log(
        `  id=${m.id} booth=${m.booth_id} amount=${m.amount} cost_type=${m.cost_type} category=${m.category} label=${m.label ?? ""} date=${m.entry_date}${tag}`,
      );
    }
    if (other.length > 0) {
      console.log("\n⚠ Other mismatches found — review before dropping cost_type.");
    } else {
      console.log("\n✓ Only known B+ corrections — category-based classification is intentional.");
    }
  }

  console.log("\nCrosscheck complete (informational — always passes unless DB error).");
} catch (err) {
  console.error("Crosscheck crashed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
