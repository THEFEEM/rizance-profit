/**
 * Production smoke: /pricing checkout must not return "No such customer".
 */
import { chromium } from "playwright";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_CUSTOMER = "cus_FAKE_PROD_ORPHAN_99999";
const stamp = Date.now();
const email = `prod-checkout-smoke-${stamp}@rizance.test`;
const password = `Smoke${stamp}!`;

const BASES = ["https://www.rizance.com", "https://rizance.com"];

function loadDbUrl() {
  const text = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL missing");
  return m[1].trim();
}

async function main() {
  const client = new pg.Client({
    connectionString: loadDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let base = BASES[0];
  for (const candidate of BASES) {
    const res = await page.goto(`${candidate}/login`, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (res && res.status() < 400) {
      base = candidate;
      break;
    }
  }
  console.log("Using base:", base);

  await page.evaluate(
    async ({ email, password }) => {
      const reg = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          shopName: "Prod Smoke Shop",
          mode: "regular",
        }),
      });
      if (!reg.ok) throw new Error(`register ${reg.status}`);
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!login.ok) throw new Error(`login ${login.status}`);
    },
    { email, password },
  );

  // Simulate orphan test customer id (worst case before fix)
  await client.query(
    `UPDATE users SET stripe_customer_id = $1, subscription_plan = 'free', subscription_expires_at = NULL WHERE email = $2`,
    [FAKE_CUSTOMER, email],
  );

  const subBefore = await client.query(
    `SELECT subscription_plan, stripe_customer_id FROM users WHERE email = $1`,
    [email],
  );
  console.log("User before checkout:", subBefore.rows[0]);

  await page.goto(`${base}/pricing`, { waitUntil: "networkidle", timeout: 30000 });

  const checkoutRes = await page.evaluate(async () => {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan: "business" }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  });

  console.log("Checkout API:", JSON.stringify(checkoutRes, null, 2));

  const message = checkoutRes.body?.error?.message ?? "";
  const raw = JSON.stringify(checkoutRes.body);
  const noSuchCustomer = /No such customer/i.test(raw);

  const after = await client.query(
    `SELECT stripe_customer_id FROM users WHERE email = $1`,
    [email],
  );
  console.log("stripe_customer_id after:", after.rows[0]?.stripe_customer_id);

  const ok =
    checkoutRes.status === 200 &&
    checkoutRes.body?.data?.url?.includes("checkout.stripe.com") &&
    !noSuchCustomer &&
    !/No such customer/i.test(message) &&
    after.rows[0]?.stripe_customer_id?.startsWith("cus_") &&
    after.rows[0]?.stripe_customer_id !== FAKE_CUSTOMER;

  await page.goto(`${base}/pricing`, { waitUntil: "networkidle" });
  const pageText = await page.content();
  const uiShowsStripeError = /No such customer/i.test(pageText);

  console.log(ok ? "PASS prod checkout smoke" : "FAIL prod checkout smoke");
  if (uiShowsStripeError) console.log("FAIL UI still shows No such customer");

  await browser.close();
  await client.end();
  process.exit(ok && !uiShowsStripeError ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
