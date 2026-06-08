// Runs db/schema.sql then db/migrations/*.sql (sorted) against DATABASE_URL.
//
// DATABASE_URL resolution (first wins):
//   1. Shell environment (e.g. DATABASE_URL=... npm run db:migrate) — use for prod
//   2. .env.local / .env in project root (local dev)
//
// Usage: npm run db:migrate
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Minimal .env loader (no dependency). Prefers .env.local, then .env.
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
    // file not present — fine
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Export it in your shell or copy .env.example to .env.local.",
  );
  process.exit(1);
}

const needsSsl = /sslmode=require/i.test(connectionString) || /neon\.tech|supabase\.co|amazonaws\.com/i.test(connectionString);

const migrationFiles = readdirSync(join(root, "db", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();

  const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
  await client.query(schema);
  console.log("✓ schema.sql applied");

  for (const file of migrationFiles) {
    const sql = readFileSync(join(root, "db", "migrations", file), "utf8");
    await client.query(sql);
    console.log(`✓ ${file} applied`);
  }

  console.log("✓ All migrations complete.");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
