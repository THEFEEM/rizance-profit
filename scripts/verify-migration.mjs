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

// read-only — ตรวจ prod ได้ ไม่ต้องตั้ง ALLOW_PROD_DB
const client = new pg.Client(
  pgClientOptions(process.env.DATABASE_URL, { allowProduction: true }),
);
await client.connect();

const check = process.argv[2] ?? "0046";

if (check === "0046") {
  console.log("=== VERIFY 0046: information_schema.columns ===");
  const r = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'capital_transactions'
       AND column_name = 'payment_method'`,
  );
  console.log(JSON.stringify(r.rows, null, 2));

  const r2 = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'capital_transactions'::regclass
       AND conname = 'capital_transactions_payment_method_check'`,
  );
  console.log("\n=== constraint ===");
  console.log(JSON.stringify(r2.rows, null, 2));
} else if (check === "0047") {
  console.log("=== VERIFY 0047: chart_of_accounts 3100 ===");
  const r = await client.query(
    `SELECT account_code, account_name, display_name, account_type, normal_balance
     FROM chart_of_accounts WHERE account_code = '3100'`,
  );
  console.log(JSON.stringify(r.rows, null, 2));
}

await client.end();
