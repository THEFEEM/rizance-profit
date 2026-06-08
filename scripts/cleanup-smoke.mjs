// Removes smoke-test and verify-test users from the database.
// Usage: node scripts/cleanup-smoke.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const needsSsl = /sslmode=require/i.test(connectionString) || /neon\.tech|supabase\.co/i.test(connectionString);
const client = new pg.Client({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rowCount } = await client.query(
    `DELETE FROM users WHERE email LIKE 'smoke-%@rizance.test'
       OR email LIKE 'colors-%@rizance.test'
       OR email LIKE 'tz-check-%@rizance.test'`,
  );
  console.log(`✓ Removed ${rowCount ?? 0} test user(s) and their entries (CASCADE).`);
} catch (err) {
  console.error("Cleanup failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
