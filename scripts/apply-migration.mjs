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
    // skip
  }
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <migration-filename.sql>");
  process.exit(1);
}

const sql = readFileSync(join(root, "db", "migrations", file), "utf8");
const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));

await client.connect();
const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
if (applied.rowCount) {
  console.log(`↷ ${file} already applied`);
} else {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`✓ ${file} applied`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
await client.end();
