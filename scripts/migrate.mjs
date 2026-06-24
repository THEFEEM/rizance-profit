// Runs db/schema.sql then db/migrations/*.sql (sorted) against DATABASE_URL.
// Tracks applied migrations in schema_migrations — each file runs at most once.
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
import { pgClientOptions } from "./pg-config.mjs";

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

// Safety: print which host we're about to migrate (mask password).
const masked = connectionString.replace(/:([^:@/]+)@/, ":****@");
console.log(`→ Target: ${masked}`);

const migrationFiles = readdirSync(join(root, "db", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client(pgClientOptions(connectionString));

try {
  await client.connect();

  // schema.sql is idempotent (IF NOT EXISTS) — always safe to run.
  const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
  await client.query(schema);
  console.log("✓ schema.sql applied");

  // Ensure tracking table exists.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Load already-applied versions.
  const { rows } = await client.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  let ran = 0;
  let skipped = 0;
  for (const file of migrationFiles) {
    if (applied.has(file)) {
      console.log(`↷ ${file} skipped (already applied)`);
      skipped++;
      continue;
    }
    const sql = readFileSync(join(root, "db", "migrations", file), "utf8");
    // Run SQL + record version atomically. If the migration already manages its
    // own BEGIN/COMMIT, the outer transaction still records the version only on success.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✓ ${file} applied`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  console.log(`✓ Done. ${ran} applied, ${skipped} skipped, ${migrationFiles.length} total.`);
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
