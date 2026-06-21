// E8.1 — subscription tier resolution + period extension logic.
// Usage: npm run test:subscription
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

/** Keep in sync with lib/subscription.ts */
function resolveActiveTier(tier, periodEnd, now = new Date()) {
  if (!periodEnd) return "free";
  const end = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  if (Number.isNaN(end.getTime()) || end <= now) return "free";
  const tiers = new Set([
    "free",
    "event_pass",
    "business",
    "business_pro",
    "org_lite",
    "org_pro",
  ]);
  return tiers.has(tier) ? tier : "free";
}

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

console.log("=== E8.1 SUBSCRIPTION LOGIC TEST ===\n");

const now = new Date("2026-06-20T12:00:00.000Z");
const future = new Date("2026-07-20T12:00:00.000Z");
const past = new Date("2026-06-01T12:00:00.000Z");

assertEq("no period end → free", resolveActiveTier("business", null, now), "free");
assertEq("expired period → free", resolveActiveTier("business_pro", past, now), "free");
assertEq("active period → tier", resolveActiveTier("business", future, now), "business");
assertEq("unknown tier → free", resolveActiveTier("vip", future, now), "free");

const fromNow = computeExtendedPeriodEnd(null, 7, now);
assertEq("extend from now +7d", fromNow.toISOString().slice(0, 10), "2026-06-27");

const fromFuture = computeExtendedPeriodEnd(future, 30, now);
assertEq("extend from future end +30d", fromFuture.toISOString().slice(0, 10), "2026-08-19");

const fromPast = computeExtendedPeriodEnd(past, 7, now);
assertEq("expired end extends from now +7d", fromPast.toISOString().slice(0, 10), "2026-06-27");

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.log("\n⊘ DB tests skipped (DATABASE_URL not set)");
} else {
  const client = new pg.Client(pgClientOptions(cs));
  try {
    await client.connect();

    const tbl = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'user_subscriptions'`,
    );
    if (tbl.rows.length === 0) {
      console.log("\n⊘ DB integration skipped (migration 0021 not applied)");
    } else {
      const email = `e8-1-sub-${Date.now()}@rizance.test`;
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, shop_name)
         VALUES ($1, 'x', 'Sub Test') RETURNING id`,
        [email],
      );
      const userId = userRes.rows[0].id;

      const noRow = await client.query(
        `SELECT tier, current_period_end FROM user_subscriptions WHERE user_id = $1`,
        [userId],
      );
      assertTrue("no subscription row yet", noRow.rows.length === 0);

      const expiredEnd = new Date("2026-01-01T00:00:00.000Z");
      await client.query(
        `INSERT INTO user_subscriptions (user_id, tier, current_period_end)
         VALUES ($1, 'business', $2)`,
        [userId, expiredEnd.toISOString()],
      );

      const row = await client.query(
        `SELECT tier, current_period_end FROM user_subscriptions WHERE user_id = $1`,
        [userId],
      );
      assertEq(
        "DB expired → resolve free",
        resolveActiveTier(row.rows[0].tier, row.rows[0].current_period_end, now),
        "free",
      );

      const newEnd = computeExtendedPeriodEnd(row.rows[0].current_period_end, 30, now);
      await client.query(
        `INSERT INTO user_subscriptions (user_id, tier, current_period_end)
         VALUES ($1, 'business_pro', $2)
         ON CONFLICT (user_id) DO UPDATE SET
           tier = EXCLUDED.tier,
           current_period_end = EXCLUDED.current_period_end,
           updated_at = now()`,
        [userId, newEnd.toISOString()],
      );

      const active = await client.query(
        `SELECT tier, current_period_end FROM user_subscriptions WHERE user_id = $1`,
        [userId],
      );
      assertEq(
        "DB after extend → business_pro",
        resolveActiveTier(active.rows[0].tier, active.rows[0].current_period_end, now),
        "business_pro",
      );
      assertTrue(
        "DB period end in future",
        new Date(active.rows[0].current_period_end) > now,
      );

      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("\n✓ DB integration passed");
    }
  } catch (err) {
    console.error("\n✗ DB test failed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.exitCode) {
  console.log("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll assertions passed.");
