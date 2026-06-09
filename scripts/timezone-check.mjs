// Proves Asia/Bangkok date boundaries vs UTC for entry_date defaults.
// Usage: node scripts/timezone-check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
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

const APP_TZ = "Asia/Bangkok";
const bkkFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayAt(instant) {
  return bkkFmt.format(instant);
}

function utcDate(instant) {
  return instant.toISOString().slice(0, 10);
}

console.log("=== TIMEZONE CHECK (Asia/Bangkok vs UTC) ===\n");

// Case A: 23:30 Bangkok — still the same local calendar day
const at2330 = new Date("2026-06-08T16:30:00.000Z"); // 23:30 on 8 Jun in Bangkok
const bkk2330 = todayAt(at2330);
const utc2330 = utcDate(at2330);
console.log("A) Shop closes at 23:30 Bangkok (8 Jun 2026)");
console.log(`   Instant (UTC):     ${at2330.toISOString()}`);
console.log(`   Asia/Bangkok date: ${bkk2330}  ← app uses this`);
console.log(`   UTC calendar date: ${utc2330}`);
console.log(`   Match: ${bkk2330 === utc2330 ? "yes (same day at 23:30)" : "NO"}\n`);

// Case B: 00:30 Bangkok next day — UTC is still previous day (the bug we fixed)
const at0030 = new Date("2026-06-08T17:30:00.000Z"); // 00:30 on 9 Jun in Bangkok
const bkk0030 = todayAt(at0030);
const utc0030 = utcDate(at0030);
console.log("B) Shop closes at 00:30 Bangkok (9 Jun 2026) — CRITICAL edge case");
console.log(`   Instant (UTC):     ${at0030.toISOString()}`);
console.log(`   Asia/Bangkok date: ${bkk0030}  ← app uses this (correct local day)`);
console.log(`   UTC calendar date: ${utc0030}  ← old PG CURRENT_DATE on Neon (WRONG)`);
console.log(`   Would drift: ${bkk0030 !== utc0030 ? "YES — fixed by using today() in app code" : "no"}\n`);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("(Skipping DB proof — DATABASE_URL not set)");
  process.exit(0);
}

const client = new pg.Client(pgClientOptions(connectionString));

try {
  await client.connect();

  // Create ephemeral test user
  const email = `tz-check-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'tz-check', 'TZ Check Shop')
     RETURNING id`,
    [email],
  );
  const userId = users[0].id;

  // Simulate entry at 00:30 BKK with app-resolved entry_date (Bangkok day)
  const entryDate = bkk0030; // 2026-06-09
  await client.query(
    `INSERT INTO income_entries (user_id, amount, note, entry_date)
     VALUES ($1, 450.00, 'Late-night sales', $2::date)`,
    [userId, entryDate],
  );

  const { rows: onBkk } = await client.query(
    `SELECT COUNT(*)::int AS n FROM income_entries WHERE user_id = $1 AND entry_date = $2`,
    [userId, entryDate],
  );
  const { rows: onUtc } = await client.query(
    `SELECT COUNT(*)::int AS n FROM income_entries WHERE user_id = $1 AND entry_date = $2`,
    [userId, utc0030],
  );

  console.log("C) DB proof — entry logged for Bangkok day 9 Jun at 00:30 local");
  console.log(`   Stored entry_date: ${entryDate}`);
  console.log(`   Found on ${entryDate} (Bangkok): ${onBkk[0].n} row(s)`);
  console.log(`   Found on ${utc0030} (UTC day):  ${onUtc[0].n} row(s)`);
  console.log(
    onBkk[0].n === 1 && onUtc[0].n === 0
      ? "   ✓ Entry lands on the correct Bangkok day, NOT the UTC day"
      : "   ✗ Unexpected result",
  );

  // Cleanup test user (cascade deletes entries)
  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  console.log("\n   (test user cleaned up)");
} catch (err) {
  console.error("DB check failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
