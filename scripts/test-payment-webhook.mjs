// E8.3 — idempotent webhook fulfillment (DB layer).
// Usage: npm run test:payment-webhook
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // optional
  }
}

/** Keep in sync with lib/subscription.ts computeExtendedPeriodEnd */
function computeExtendedPeriodEnd(currentEnd, days, now = new Date()) {
  let base = now;
  if (currentEnd) {
    const end = currentEnd instanceof Date ? currentEnd : new Date(currentEnd);
    if (!Number.isNaN(end.getTime()) && end > now) base = end;
  }
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function findPayment(client, chargeId) {
  const { rows } = await client.query(
    `SELECT status, paid_at FROM payment_records WHERE omise_charge_id = $1`,
    [chargeId],
  );
  return rows[0] ?? null;
}

async function markPaymentPaidIfPending(client, chargeId) {
  const { rows } = await client.query(
    `UPDATE payment_records
     SET status = 'paid', paid_at = now()
     WHERE omise_charge_id = $1 AND status = 'pending'
     RETURNING user_id, tier, period_days`,
    [chargeId],
  );
  return rows[0] ?? null;
}

async function extendPeriod(client, userId, tier, days, now) {
  const { rows: existing } = await client.query(
    `SELECT current_period_end FROM user_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const currentEnd = existing[0]?.current_period_end ?? null;
  const newEnd = computeExtendedPeriodEnd(currentEnd, days, now);
  await client.query(
    `INSERT INTO user_subscriptions (user_id, tier, current_period_end)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       tier = EXCLUDED.tier,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = now()`,
    [userId, tier, newEnd.toISOString()],
  );
  return newEnd;
}

async function fulfillPaidPaymentRecord(client, chargeId, now) {
  const record = await findPayment(client, chargeId);
  if (!record) return "not_found";
  if (record.status === "paid") return "already_paid";

  const flipped = await markPaymentPaidIfPending(client, chargeId);
  if (!flipped) {
    const again = await findPayment(client, chargeId);
    if (again?.status === "paid") return "already_paid";
    return "skipped";
  }

  await extendPeriod(client, flipped.user_id, flipped.tier, flipped.period_days, now);
  return "extended";
}

function assertTrue(label, cond) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

function assertEq(label, actual, expected) {
  return assertTrue(label, actual === expected);
}

console.log("=== E8.3 PAYMENT WEBHOOK IDEMPOTENCY TEST ===\n");

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.log("⊘ DB tests skipped (DATABASE_URL not set)");
  process.exit(0);
}

const client = new pg.Client(pgClientOptions(cs));
const now = new Date("2026-06-20T12:00:00.000Z");
const chargeId = `chrg_test_e83_${Date.now()}`;

try {
  await client.connect();

  const tbl = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'payment_records'`,
  );
  if (tbl.rows.length === 0) {
    console.log("⊘ DB integration skipped (migration 0021 not applied)");
    process.exit(0);
  }

  const email = `e8-3-webhook-${Date.now()}@rizance.test`;
  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'x', 'Webhook Test') RETURNING id`,
    [email],
  );
  const userId = userRes.rows[0].id;

  await client.query(
    `INSERT INTO payment_records (user_id, tier, amount, period_days, status, omise_charge_id)
     VALUES ($1, 'event_pass', 39, 7, 'pending', $2)`,
    [userId, chargeId],
  );

  const r1 = await fulfillPaidPaymentRecord(client, chargeId, now);
  const r2 = await fulfillPaidPaymentRecord(client, chargeId, now);
  const r3 = await fulfillPaidPaymentRecord(client, chargeId, now);

  assertEq("1st call extends", r1, "extended");
  assertEq("2nd call already_paid", r2, "already_paid");
  assertEq("3rd call already_paid", r3, "already_paid");

  const pay = await findPayment(client, chargeId);
  assertEq("payment status paid", pay.status, "paid");
  assertTrue("paid_at set", pay.paid_at !== null);

  const sub = await client.query(
    `SELECT tier, current_period_end FROM user_subscriptions WHERE user_id = $1`,
    [userId],
  );
  assertEq("subscription tier", sub.rows[0].tier, "event_pass");
  const expectedEnd = computeExtendedPeriodEnd(null, 7, now).toISOString().slice(0, 10);
  assertEq(
    "period end +7 days from now",
    new Date(sub.rows[0].current_period_end).toISOString().slice(0, 10),
    expectedEnd,
  );

  // unpaid charge id → not_found
  const missing = await fulfillPaidPaymentRecord(client, "chrg_test_missing", now);
  assertEq("unknown chargeId → not_found", missing, "not_found");

  await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  console.log("\n✓ DB idempotency passed");
} catch (err) {
  console.error("\n✗ DB test failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

if (process.exitCode) {
  console.log("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll assertions passed.");
