// Verify subscription state after manual Stripe checkout (Tests A/B).
// Usage: node scripts/verify-subscription-user.mjs [email]
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // optional
  }
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/verify-subscription-user.mjs <email>");
  process.exit(1);
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
await client.connect();

const { rows } = await client.query(
  `SELECT id, email, subscription_plan, subscription_expires_at, stripe_subscription_id, stripe_customer_id
   FROM users WHERE email = $1`,
  [email],
);

if (rows.length === 0) {
  console.error(`No user found for ${email}`);
  process.exit(1);
}

const u = rows[0];
console.log("\n=== Subscription state ===");
console.log("user_id:", u.id);
console.log("email:", u.email);
console.log("subscription_plan:", u.subscription_plan);
console.log("subscription_expires_at:", u.subscription_expires_at);
console.log("stripe_subscription_id:", u.stripe_subscription_id ?? "(null)");
console.log("stripe_customer_id:", u.stripe_customer_id ?? "(null)");

const { rows: payments } = await client.query(
  `SELECT plan, status, amount, created_at FROM stripe_payments
   WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
  [u.id],
);
console.log("\nRecent stripe_payments:");
for (const p of payments) {
  console.log(`  - ${p.plan} ${p.status} ฿${(p.amount / 100).toFixed(0)} @ ${p.created_at.toISOString()}`);
}

await client.end();
