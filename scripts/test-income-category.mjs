// Income category migration + API backward compatibility.
// Usage: npm run dev, then npm run test:income-category
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SignJWT } from "jose";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import { INCOME_CATEGORIES, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "./expense-categories-core.mjs";

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

const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL));
let userId = null;
let boothId = null;

try {
  await client.connect();
  console.log("=== INCOME CATEGORY TEST ===\n");

  const base = await detectBase();
  if (!base) throw new Error("Dev server not detected — run: npm run dev");

  const email = `inc-cat-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'inc-cat', 'Cat Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  await makeSessionCookie(userId);

  console.log("1) POST /api/income without category → defaults storefront");
  let res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({ amount: 100, entryDate: "2026-06-10" }),
  });
  assertEq("status", String(res.status), "201");
  assertEq("category", res.body?.data?.category ?? "missing", "storefront");
  console.log("");

  console.log("2) POST /api/income with delivery + transfer");
  res = await apiJson(base, "/api/income", {
    method: "POST",
    body: JSON.stringify({
      amount: 50,
      category: "delivery",
      paymentMethod: "transfer",
      entryDate: "2026-06-10",
    }),
  });
  assertEq("status", String(res.status), "201");
  assertEq("category", res.body?.data?.category ?? "missing", "delivery");
  assertEq("paymentMethod", res.body?.data?.paymentMethod ?? "missing", "transfer");
  console.log("");

  console.log("3) Shop income form — 6 category chips + payment toggle");
  const page = await fetch(`${base}/income`, { headers: { Cookie: cookie } });
  const html = await page.text();
  assertEq("page status", String(page.status), "200");
  for (const c of INCOME_CATEGORIES) {
    assertEq(`has ${c.label}`, html.includes(c.label) ? "yes" : "no", "yes");
  }
  for (const m of PAYMENT_METHODS) {
    assertEq(`has ${PAYMENT_METHOD_LABELS[m]}`, html.includes(PAYMENT_METHOD_LABELS[m]) ? "yes" : "no", "yes");
  }
  console.log("");

  console.log("4) Booth income API accepts category");
  const { rows: booths } = await client.query(
    `INSERT INTO booths (user_id, name, pool_budget, start_date, end_date)
     VALUES ($1, 'Inc Cat Booth', 0, '2026-06-10'::date, '2026-06-10'::date) RETURNING id`,
    [userId],
  );
  boothId = booths[0].id;
  res = await apiJson(base, `/api/booths/${boothId}/income`, {
    method: "POST",
    body: JSON.stringify({
      amount: 200,
      category: "service",
      paymentMethod: "cash",
      entryDate: "2026-06-10",
    }),
  });
  assertEq("booth income status", String(res.status), "201");
  assertEq("booth category", res.body?.data?.category ?? "missing", "service");
  console.log("");

  console.log("5) Expense form still shows legacy CategoryGrid (GROUP 2 pending)");
  const expPage = await fetch(`${base}/expense`, { headers: { Cookie: cookie } });
  const expHtml = await expPage.text();
  assertEq("expense page status", String(expPage.status), "200");
  assertEq("has วัตถุดิบ", expHtml.includes("วัตถุดิบ") ? "yes" : "no", "yes");
  console.log("");

  if (failed === 0) console.log("All assertions passed.");
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
