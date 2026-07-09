// RBP-001 Receive Money — business-rule baseline (complements test-income-category.mjs).
// Usage: npm run dev, then npm run test:receive-money
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
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

let cookie = "";

async function makeSessionCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing or too short");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  cookie = `rizance_session=${token}`;
}

async function detectBase() {
  for (const port of [3002, 3001, 3000, 3003]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/context`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200 || res.status === 401) return `http://localhost:${port}`;
    } catch {
      // next
    }
  }
  return null;
}

async function apiJson(base, path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  return { status: res.status, body: await res.json() };
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed++;
  }
}

function assertMoney(label, actual, expected) {
  const ok = Number(actual) === Number(expected);
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed++;
  }
}

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;

try {
  await client.connect();
  console.log("=== RBP-001 RECEIVE MONEY BASELINE ===\n");

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  const email = `rbp001-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'rbp001', 'RBP001 Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  console.log("1) Cash income increases cashOnHand only");
  let res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 100, paymentMethod: "cash", entryDate: "2026-06-10" }),
  });
  assertEq("cash POST status", String(res.status), "201");
  const { rows: cashOnHand1 } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END),0)::text AS cash_income,
       COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END),0)::text AS transfer_income
     FROM income_entries WHERE user_id=$1 AND voided_at IS NULL`,
    [userId],
  );
  assertMoney("cash income total", cashOnHand1[0].cash_income, "100.00");
  assertMoney("transfer income still 0", cashOnHand1[0].transfer_income, "0.00");
  console.log("");

  console.log("2) Transfer income increases transferOnHand bucket");
  res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 50, paymentMethod: "transfer", entryDate: "2026-06-10" }),
  });
  assertEq("transfer POST status", String(res.status), "201");
  const { rows: onHand2 } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END),0)::text AS cash_income,
       COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END),0)::text AS transfer_income
     FROM income_entries WHERE user_id=$1 AND voided_at IS NULL`,
    [userId],
  );
  assertMoney("cash income", onHand2[0].cash_income, "100.00");
  assertMoney("transfer income", onHand2[0].transfer_income, "50.00");
  console.log("");

  console.log("3) entry_date can differ from created_at (backdating)");
  res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 25, entryDate: "2026-01-01" }),
  });
  assertEq("backdate POST status", String(res.status), "201");
  const entryId = res.body?.data?.id;
  const { rows: dated } = await client.query(
    `SELECT entry_date::text, created_at::date::text AS created_day
     FROM income_entries WHERE id=$1`,
    [entryId],
  );
  assertEq("entry_date", dated[0].entry_date, "2026-01-01");
  assertEq("entry_date != created day", dated[0].entry_date === dated[0].created_day ? "same" : "different", "different");
  console.log("");

  console.log("4) amount must be > 0 (API validation)");
  res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 0, entryDate: "2026-06-10" }),
  });
  assertEq("zero amount status", String(res.status), "400");
  console.log("");

  console.log("5) voided_at rows excluded from on-hand aggregate");
  const { rows: cashRow } = await client.query(
    `SELECT id FROM income_entries
     WHERE user_id=$1 AND voided_at IS NULL AND payment_method='cash' AND amount=100
     LIMIT 1`,
    [userId],
  );
  await client.query(
    `UPDATE income_entries SET voided_at=now(), void_reason='rbp001 test' WHERE id=$1`,
    [cashRow[0].id],
  );
  const { rows: afterVoid } = await client.query(
    `SELECT COALESCE(SUM(amount),0)::text AS total
     FROM income_entries WHERE user_id=$1 AND voided_at IS NULL`,
    [userId],
  );
  assertMoney("active total after void (175 - 100)", afterVoid[0].total, "75.00");
  console.log("");

  console.log("6) defaults: category=storefront, paymentMethod=cash");
  res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 10, entryDate: "2026-06-11" }),
  });
  assertEq("defaults POST status", String(res.status), "201");
  const { rows: defaults } = await client.query(
    `SELECT category, payment_method FROM income_entries WHERE id=$1`,
    [res.body?.data?.id],
  );
  assertEq("default category", defaults[0].category, "storefront");
  assertEq("default payment_method", defaults[0].payment_method, "cash");
  console.log("");

  if (failed === 0) console.log("All RBP-001 baseline assertions passed.");
  else {
    console.error(`${failed} assertion(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log("(test user cleaned up — CASCADE)");
  }
  await client.end();
}
