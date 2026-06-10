// Rejects narrowing booth date range when entries would fall outside.
// Mirrors countBoothEntriesOutsideRange + updateBooth guard in lib/booth-queries.ts.
// Usage: npm run test:booth-update-range
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

async function countOutside(client, boothId, start, end) {
  const { rows } = await client.query(
    `SELECT (
       (SELECT COUNT(*) FROM booth_income_entries
        WHERE booth_id = $1 AND (entry_date < $2::date OR entry_date > $3::date)) +
       (SELECT COUNT(*) FROM booth_expense_entries
        WHERE booth_id = $1 AND (entry_date < $2::date OR entry_date > $3::date))
     )::int AS count`,
    [boothId, start, end],
  );
  return rows[0].count;
}

/** Same guard logic as updateBooth — returns reason or null if update may proceed. */
async function guardNarrowedRange(client, boothId, existing, newStart, newEnd) {
  const rangeNarrowed = newStart > existing.start_date || newEnd < existing.end_date;
  if (!rangeNarrowed) return null;
  const outside = await countOutside(client, boothId, newStart, newEnd);
  if (outside > 0) return { reason: "entries_outside_new_range", count: outside };
  return null;
}

let failed = 0;
function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== BOOTH UPDATE RANGE GUARD TEST ===\n");

  const email = `booth-range-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'booth-range-test', 'Range Test') RETURNING id`,
    [email],
  );
  userId = users[0].id;

  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, starting_budget, start_date, end_date)
     VALUES ($1, 'งาน 3 วัน', 500.00, '2026-06-09'::date, '2026-06-11'::date)
     RETURNING id, start_date::text AS start_date, end_date::text AS end_date`,
    [userId],
  );
  const boothId = booths[0].id;
  const existing = booths[0];

  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
     VALUES ($1, $2, 100.00, 'cash', '2026-06-10'::date)`,
    [boothId, userId],
  );

  console.log("1) Narrowing range rejects when entry falls outside");
  const reject = await guardNarrowedRange(client, boothId, existing, "2026-06-09", "2026-06-09");
  assert("guard returns entries_outside_new_range", reject?.reason === "entries_outside_new_range");
  assert("count = 1", reject?.count === 1, `got ${reject?.count}`);

  // Booth dates must stay unchanged (no UPDATE applied)
  const { rows: after } = await client.query(
    `SELECT end_date::text AS end_date FROM booths WHERE id = $1`,
    [boothId],
  );
  assert("booth end_date unchanged", after[0].end_date === "2026-06-11");

  console.log("\n2) Widening range is allowed (no entries outside new range)");
  const widen = await guardNarrowedRange(client, boothId, existing, "2026-06-09", "2026-06-12");
  assert("guard returns null when widening", widen === null);
  await client.query(
    `UPDATE booths SET end_date = '2026-06-12'::date WHERE id = $1`,
    [boothId],
  );
  const { rows: widened } = await client.query(
    `SELECT end_date::text AS end_date FROM booths WHERE id = $1`,
    [boothId],
  );
  assert("booth end_date updated to 2026-06-12", widened[0].end_date === "2026-06-12");

  console.log("");
  if (failed === 0) {
    console.log("All assertions passed.");
  } else {
    console.error(`${failed} assertion(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("(test user cleaned up)");
  }
  await client.end();
}
