/**
 * Test checkout customer recovery: fake stripe_customer_id → live customer + session URL.
 * Run: $env:NODE_TLS_REJECT_UNAUTHORIZED='0'; $env:DATABASE_URL='...'; node scripts/test-checkout-customer-recovery.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const text = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv();

const PROFIT = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
const FAKE_CUSTOMER = "cus_FAKE_DOES_NOT_EXIST_12345";
const stamp = Date.now();
const email = `checkout-recovery-${stamp}@rizance.test`;
const password = `Test${stamp}!`;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Register + business plan
const regRes = await fetch(`${PROFIT}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, shopName: "Recovery Test", mode: "regular" }),
});
if (!regRes.ok) throw new Error(`register ${regRes.status}`);

const loginRes = await fetch(`${PROFIT}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const cookie = loginRes.headers.getSetCookie?.() ?? [];
const cookieHeader = cookie.map((c) => c.split(";")[0]).join("; ");

await client.query(
  `UPDATE users SET subscription_plan = 'business', subscription_expires_at = now() + interval '30 days',
   stripe_customer_id = $1 WHERE email = $2`,
  [FAKE_CUSTOMER, email],
);

const checkoutRes = await fetch(`${PROFIT}/api/checkout`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ plan: "business" }),
});
const checkoutBody = await checkoutRes.json();
console.log("checkout status:", checkoutRes.status);
console.log("checkout body:", JSON.stringify(checkoutBody, null, 2));

const { rows } = await client.query(
  `SELECT stripe_customer_id FROM users WHERE email = $1`,
  [email],
);
const newCustomerId = rows[0]?.stripe_customer_id;
console.log("new stripe_customer_id:", newCustomerId);

const ok =
  checkoutRes.ok &&
  checkoutBody?.data?.url?.includes("checkout.stripe.com") &&
  newCustomerId &&
  newCustomerId !== FAKE_CUSTOMER &&
  newCustomerId.startsWith("cus_");

console.log(ok ? "PASS checkout customer recovery" : "FAIL checkout customer recovery");
await client.end();
process.exit(ok ? 0 : 1);
