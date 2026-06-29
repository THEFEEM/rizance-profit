// Stripe subscription flow — automated checks before merge.
// Usage: npm run test:stripe-flow
import pg from "pg";
import Stripe from "stripe";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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

const DATABASE_URL = process.env.DATABASE_URL;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

let exitCode = 0;

function pass(label) {
  console.log(`✓ ${label}`);
}

function fail(label, detail) {
  console.error(`✗ ${label}${detail ? `: ${detail}` : ""}`);
  exitCode = 1;
}

function assert(label, cond, detail) {
  if (cond) pass(label);
  else fail(label, detail);
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function signSession(userId) {
  const key = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

async function postWebhook(stripe, event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  });
  const res = await fetch(`${APP_URL}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function checkoutCompletedEvent({ sessionId, userId, plan, subscriptionId }) {
  return {
    id: `evt_test_${Date.now()}_${plan}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        metadata: { userId, plan },
        subscription: subscriptionId ?? null,
      },
    },
  };
}

async function createTestUser(client, tag) {
  const email = `stripe-flow-${tag}-${Date.now()}@rizance.test`;
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [email, `Stripe Flow ${tag}`],
  );
  return rows[0].id;
}

async function seedPendingPayment(client, userId, sessionId, plan, amount) {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + (plan === "event_pass" ? 7 : 30));
  await client.query(
    `INSERT INTO stripe_payments (user_id, stripe_session_id, plan, amount, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, sessionId, plan, amount, expires.toISOString()],
  );
}

console.log("=== STRIPE SUBSCRIPTION FLOW TEST ===\n");

if (!DATABASE_URL) {
  fail("DATABASE_URL set", false);
  process.exit(1);
}
if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  fail("Stripe env vars set", false, "STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET");
  process.exit(1);
}
if (!JWT_SECRET) {
  fail("JWT_SECRET set", false);
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-06-24.dahlia" });
const client = new pg.Client(pgClientOptions(DATABASE_URL));
const createdUserIds = [];

try {
  await client.connect();

  // Schema (migration 0032)
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name IN ('subscription_plan', 'subscription_expires_at', 'stripe_subscription_id')`,
  );
  assert("migration 0032 users columns", cols.rows.length === 3);

  const paymentsTbl = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'stripe_payments'`,
  );
  assert("stripe_payments table exists", paymentsTbl.rows.length === 1);

  const usageTbl = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'usage_counters'`,
  );
  assert("usage_counters table exists", usageTbl.rows.length === 1);

  // Test 1 + 3: webhook fulfillment
  console.log("\n--- Test 1/3: Webhook → DB ---");

  for (const [plan, subscriptionId, amount] of [
    ["business", "sub_test_business_001", 9900],
    ["event_pass", null, 4900],
  ]) {
    const userId = await createTestUser(client, plan);
    createdUserIds.push(userId);
    const sessionId = `cs_test_${plan}_${Date.now()}`;
    await seedPendingPayment(client, userId, sessionId, plan, amount);

    const event = checkoutCompletedEvent({ sessionId, userId, plan, subscriptionId });
    const wh = await postWebhook(stripe, event);
    assert(`webhook ${plan} → HTTP 200`, wh.status === 200, `got ${wh.status}`);

    const user = await client.query(
      `SELECT subscription_plan, subscription_expires_at, stripe_subscription_id
       FROM users WHERE id = $1`,
      [userId],
    );
    const row = user.rows[0];
    assert(`users.subscription_plan = '${plan}'`, row.subscription_plan === plan);
    assert(`users.subscription_expires_at set (${plan})`, row.subscription_expires_at !== null);

    if (plan === "event_pass") {
      assert("event_pass stripe_subscription_id is null", row.stripe_subscription_id === null);
    } else {
      assert("business stripe_subscription_id set", row.stripe_subscription_id === subscriptionId);
    }

    const pay = await client.query(
      `SELECT status FROM stripe_payments WHERE stripe_session_id = $1`,
      [sessionId],
    );
    assert(`stripe_payments.status = completed (${plan})`, pay.rows[0]?.status === "completed");
  }

  // Test 2 (API slice): checkout session URL
  console.log("\n--- Test 2 (API): Checkout session ---");

  const checkoutUserId = await createTestUser(client, "checkout");
  createdUserIds.push(checkoutUserId);
  const token = await signSession(checkoutUserId);
  const checkoutRes = await fetch(`${APP_URL}/api/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `rizance_session=${token}`,
    },
    body: JSON.stringify({ plan: "business" }),
  });
  const checkoutText = await checkoutRes.text();
  let checkoutJson;
  try {
    checkoutJson = checkoutText ? JSON.parse(checkoutText) : null;
  } catch {
    checkoutJson = null;
  }
  assert("POST /api/checkout → 200", checkoutRes.status === 200, checkoutText.slice(0, 200) || "empty body");
  const checkoutUrl = checkoutJson?.data?.url ?? "";
  assert(
    "checkout URL is Stripe hosted",
    typeof checkoutUrl === "string" && checkoutUrl.includes("checkout.stripe.com"),
    checkoutUrl.slice(0, 80),
  );

  const pending = await client.query(
    `SELECT plan, status FROM stripe_payments
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [checkoutUserId],
  );
  assert("stripe_payments pending row created", pending.rows[0]?.status === "pending");
  assert("pending plan = business", pending.rows[0]?.plan === "business");

  // Test 4: quota enforcement
  console.log("\n--- Test 4: Quota enforcement ---");

  const quotaUserId = await createTestUser(client, "quota");
  createdUserIds.push(quotaUserId);
  const period = currentPeriod();
  await client.query(
    `INSERT INTO usage_counters (user_id, counter_key, period, count)
     VALUES ($1, 'rizq_chat', $2, 31)
     ON CONFLICT (user_id, counter_key, period)
     DO UPDATE SET count = 31`,
    [quotaUserId, period],
  );

  const quotaToken = await signSession(quotaUserId);
  const chatRes = await fetch(`${APP_URL}/api/personal/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `rizance_session=${quotaToken}`,
    },
    body: JSON.stringify({ text: "สวัสดี" }),
  });
  const chatJson = await chatRes.json();
  assert("personal chat over quota → 429", chatRes.status === 429);
  assert("quota error code", chatJson?.error?.code === "quota_exceeded");
  assert("quota limit = 30 (free)", chatJson?.error?.limit === 30);
  assert("quota used >= 30", (chatJson?.error?.used ?? 0) >= 30);
} catch (err) {
  fail("unexpected error", testingErrorMessage(err));
} finally {
  for (const id of createdUserIds) {
    try {
      await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    } catch {
      // cascade
    }
  }
  await client.end();
}

function testingErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

console.log("\n--- Manual only ---");
console.log("□ Test 2 browser: /pricing → Business → card 4242… → badge ใช้งานอยู่");
console.log("□ Test 3 browser: /pricing (booth mode) → Event Pass → subscription_id null");
console.log("□ Test 5: PromptPay QR in Stripe Checkout (Dashboard → Payment methods)");

if (exitCode) {
  console.log("\nSome checks failed.");
  process.exit(1);
}
console.log("\nAll automated checks passed.");
