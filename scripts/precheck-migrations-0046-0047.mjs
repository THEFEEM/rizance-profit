import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
await client.connect();

console.log("=== PRE-CHECK 1: capital_transactions.payment_method ===");
try {
  const r = await client.query(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE payment_method IS NOT NULL)::text AS with_pm
     FROM capital_transactions`,
  );
  console.log("RESULT:", JSON.stringify(r.rows[0]));
} catch (err) {
  console.log("ERROR (expected if column missing):", err.message);
}

console.log("\n=== PRE-CHECK 2: chart_of_accounts 3100 ===");
const r2 = await client.query(
  `SELECT account_code, account_name, display_name, account_type, normal_balance
   FROM chart_of_accounts WHERE account_code = '3100'`,
);
console.log("row_count:", r2.rowCount);
if (r2.rowCount) {
  console.log("rows:", JSON.stringify(r2.rows, null, 2));
}

await client.end();
