// Mode Even isolation test: booth data must NEVER leak into regular-shop
// summaries, and booth summaries must NEVER include regular-shop data.
// Also verifies the 0004 tables exist and their DB CHECK constraints fire.
// Usage: npm run test:booth-isolation
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

let failed = 0;
function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(connectionString));
let userId = null;

try {
  await client.connect();
  console.log("=== MODE EVEN ISOLATION TEST ===\n");

  // 0) The four 0004 tables exist
  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('booths','booth_income_entries','booth_expense_entries','booth_members')
     ORDER BY table_name`,
  );
  console.log("0) Migration tables");
  assert(
    "all 4 booth tables exist",
    tables.length === 4,
    tables.map((t) => t.table_name).join(", "),
  );
  console.log("");

  // Temp user
  const email = `booth-iso-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'booth-iso-test', 'Booth Iso Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  console.log(`Temp user: ${email}\n`);

  const date = "2026-06-10"; // one Bangkok day for everything

  // Regular shop entries (distinct amounts)
  await client.query(
    `INSERT INTO income_entries (user_id, amount, note, entry_date)
     VALUES ($1, 500.00, 'regular sales', $2::date)`,
    [userId, date],
  );
  await client.query(
    `INSERT INTO expense_entries (user_id, amount, category, note, entry_date)
     VALUES ($1, 200.00, 'materials', 'regular milk', $2::date)`,
    [userId, date],
  );

  // Booth + booth entries on the SAME date (different distinct amounts)
  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'งานวัดทดสอบ', 1000.00, $2::date, $3::date) RETURNING id`,
    [userId, "2026-06-09", "2026-06-11"],
  );
  const boothId = booths[0].id;
  await client.query(
    `INSERT INTO booth_income_entries (booth_id, user_id, amount, category, payment_method, entry_date)
     VALUES ($1, $2, 999.00, 'storefront', 'cash', $3::date), ($1, $2, 111.00, 'storefront', 'transfer', $3::date)`,
    [boothId, userId, date],
  );
  await client.query(
    `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, category, label, entry_date)
     VALUES ($1, $2, 888.00, 'fixed', 'rent', 'ค่าที่', $3::date), ($1, $2, 77.00, 'variable', 'materials', 'นม', $3::date)`,
    [boothId, userId, date],
  );

  // 1) Regular dailySummary — EXACT SQL from lib/queries.ts dailySummary()
  console.log("1) Regular dailySummary sees ONLY regular data");
  const { rows: daily } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries  WHERE user_id = $1 AND entry_date = $2), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries WHERE user_id = $1 AND entry_date = $2), 0)::text AS expense,
       (SELECT COUNT(*) FROM income_entries  WHERE user_id = $1 AND entry_date = $2)::text AS income_count,
       (SELECT COUNT(*) FROM expense_entries WHERE user_id = $1 AND entry_date = $2)::text AS expense_count`,
    [userId, date],
  );
  assert("daily income = 500.00 (not 1610)", daily[0].income === "500.00", `got ${daily[0].income}`);
  assert("daily expense = 200.00 (not 1165)", daily[0].expense === "200.00", `got ${daily[0].expense}`);
  assert("daily income_count = 1 (not 3)", daily[0].income_count === "1");
  assert("daily expense_count = 1 (not 3)", daily[0].expense_count === "1");
  console.log("");

  // 2) Regular periodSummary — EXACT SQL from lib/queries.ts periodSummary()
  console.log("2) Regular periodSummary sees ONLY regular data");
  const start = "2026-06-04"; // last_7 window containing the test date
  const end = "2026-06-10";
  const { rows: period } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries
                 WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3), 0)::text AS expense,
       (SELECT COUNT(*) FROM income_entries
        WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3)::text AS income_count,
       (SELECT COUNT(*) FROM expense_entries
        WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3)::text AS expense_count`,
    [userId, start, end],
  );
  assert("period income = 500.00", period[0].income === "500.00", `got ${period[0].income}`);
  assert("period expense = 200.00", period[0].expense === "200.00", `got ${period[0].expense}`);
  assert("period income_count = 1", period[0].income_count === "1");
  assert("period expense_count = 1", period[0].expense_count === "1");
  console.log("");

  // 3) Booth summary — EXACT SQL from lib/booth-queries.ts boothSummary()
  console.log("3) Booth summary sees ONLY booth data");
  const { rows: bsum } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'cash'), 0)::text AS cash_income,
       COALESCE((SELECT SUM(amount) FROM booth_income_entries
                 WHERE booth_id = $1 AND payment_method = 'transfer'), 0)::text AS transfer_income,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'fixed'), 0)::text AS fixed_expense,
       COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                 WHERE booth_id = $1 AND cost_type = 'variable'), 0)::text AS variable_expense,
       (SELECT COUNT(*) FROM booth_income_entries  WHERE booth_id = $1)::text AS income_count,
       (SELECT COUNT(*) FROM booth_expense_entries WHERE booth_id = $1)::text AS expense_count`,
    [boothId],
  );
  const b = bsum[0];
  assert("cash income = 999.00", b.cash_income === "999.00", `got ${b.cash_income}`);
  assert("transfer income = 111.00", b.transfer_income === "111.00", `got ${b.transfer_income}`);
  assert("fixed expense = 888.00", b.fixed_expense === "888.00", `got ${b.fixed_expense}`);
  assert("variable expense = 77.00", b.variable_expense === "77.00", `got ${b.variable_expense}`);
  assert(
    "booth total income 1110.00 excludes regular 500",
    Number(b.cash_income) + Number(b.transfer_income) === 1110,
  );
  assert("booth income_count = 2 (regular row not pulled)", b.income_count === "2");
  assert("booth expense_count = 2 (regular row not pulled)", b.expense_count === "2");
  console.log("");

  // 4) DB CHECK constraints actually fire
  console.log("4) DB CHECK constraints");
  let threw = false;
  try {
    await client.query(
      `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
       VALUES ($1, $2, 10.00, 'card', $3::date)`,
      [boothId, userId, date],
    );
  } catch (e) {
    threw = /booth_income_entries_payment_method_check/.test(e.message) || e.code === "23514";
  }
  assert("payment_method 'card' rejected", threw);

  threw = false;
  try {
    await client.query(
      `INSERT INTO booth_expense_entries (booth_id, user_id, amount, cost_type, category, entry_date)
       VALUES ($1, $2, 10.00, 'overhead', 'rent', $3::date)`,
      [boothId, userId, date],
    );
  } catch (e) {
    threw = e.code === "23514";
  }
  assert("cost_type 'overhead' rejected", threw);

  threw = false;
  try {
    await client.query(
      `INSERT INTO booths (user_id, name, start_date, end_date)
       VALUES ($1, 'bad dates', '2026-06-10'::date, '2026-06-01'::date)`,
      [userId],
    );
  } catch (e) {
    threw = e.code === "23514";
  }
  assert("end_date < start_date rejected", threw);

  threw = false;
  try {
    await client.query(
      `UPDATE booths SET status = 'paused' WHERE id = $1`,
      [boothId],
    );
  } catch (e) {
    threw = e.code === "23514";
  }
  assert("status 'paused' rejected", threw);

  threw = false;
  try {
    await client.query(
      `INSERT INTO booth_income_entries (booth_id, user_id, amount, payment_method, entry_date)
       VALUES ($1, $2, -5.00, 'cash', $3::date)`,
      [boothId, userId, date],
    );
  } catch (e) {
    threw = e.code === "23514";
  }
  assert("negative amount rejected", threw);

  threw = false;
  try {
    await client.query(`UPDATE booths SET profit_split_method = 'custom_percent' WHERE id = $1`, [
      boothId,
    ]);
  } catch (e) {
    threw = e.code === "23514";
  }
  assert("profit_split_method custom_percent rejected", threw);

  const { rows: poolCol } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'booths' AND column_name = 'pool_gets_share'`,
  );
  assert("pool_gets_share column exists", poolCol.length === 1);

  const { rows: splitCol } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'booth_members' AND column_name = 'split_percent'`,
  );
  assert("split_percent column dropped", splitCol.length === 0);

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
    console.log("(test user and data cleaned up — CASCADE)");
  }
  await client.end();
}
