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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = new pg.Client(pgClientOptions(connectionString));
  await client.connect();

  const q = async (sql) => (await client.query(sql)).rows;

  // 1)
  const r1 = await q(
    "SELECT column_name, data_type, is_nullable, column_default " +
      "FROM information_schema.columns " +
      "WHERE table_name='project_activities' AND column_name='is_general';",
  );
  console.log("VERIFY1", JSON.stringify(r1, null, 2));

  // 2)
  const r2 = await q(
    "SELECT id, project_id, name, is_general, sort_order " +
      "FROM project_activities WHERE is_general=true " +
      "ORDER BY project_id, sort_order ASC, created_at ASC;",
  );
  console.log("VERIFY2", JSON.stringify(r2, null, 2));

  // 3)
  const r3 = await q(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_name='project_income_entries' AND column_name='payment_method';",
  );
  console.log("VERIFY3", JSON.stringify(r3, null, 2));

  // 4)
  const r4 = await q(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_name='project_expense_entries' " +
      "AND column_name IN ('is_advance','reimbursed_at');",
  );
  console.log("VERIFY4", JSON.stringify(r4, null, 2));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

