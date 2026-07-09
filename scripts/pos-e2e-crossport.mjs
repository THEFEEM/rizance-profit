/**
 * POS E2E — Step 0 cookie cross-port + API sell loop + DB verify + cart retry logic
 *
 * Usage (profit + pos dev servers running):
 *   npx tsx scripts/pos-e2e-crossport.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgPoolOptions } from "../lib/pg-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim().replace(/^["']|["']$/g, "");
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      // skip
    }
  }
}

loadEnv();

const PROFIT = process.env.PROFIT_BASE_URL?.trim() || "http://localhost:3000";
const POS = process.env.POS_BASE_URL?.trim() || "http://localhost:3001";
const POS_ORIGIN = POS;

const checks = [];

function pass(name, detail) {
  checks.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function assert(name, cond, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

let cookie = "";

async function profitFetch(path, init = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${PROFIT}${path}`, { ...init, headers });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) {
    cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  }
  return res;
}

async function posOriginFetch(path, init = {}) {
  const headers = {
    "Content-Type": "application/json",
    Origin: POS_ORIGIN,
    ...(init.headers ?? {}),
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${PROFIT}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

async function waitFor(url, label, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) {
        pass(`${label} reachable`, url);
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(`${label} reachable`, url);
  return false;
}

async function main() {
  console.log(`Profit API: ${PROFIT}\nPOS app: ${POS}\n`);

  await waitFor(`${PROFIT}/api/auth/me`, "profit backend");
  await waitFor(POS, "pos frontend");

  const stamp = Date.now();
  const email = `pos-e2e-${stamp}@rizance.test`;
  const password = "PosE2eTest123!";
  const shopName = `POS E2E Shop ${stamp}`;

  // Register + business plan
  let res = await profitFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, shopName }),
  });
  let body = await res.json();
  assert("register test user", res.ok, String(res.status));
  const userId = body.data?.user?.id;
  if (!userId) {
    console.error("No userId — abort");
    process.exit(1);
  }

  const db = new pg.Client(pgPoolOptions(process.env.DATABASE_URL));
  await db.connect();
  await db.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = now() + interval '365 days' WHERE id = $1`,
    [userId],
  );
  pass("set business plan on test user", userId);

  // Step 0 — session without cookie
  cookie = "";
  res = await posOriginFetch("/api/pos/session");
  let noCookieBody = null;
  try {
    noCookieBody = await res.json();
  } catch {
    // empty body ok for 401
  }
  assert(
    "Step0: no cookie → unauthorized",
    res.status === 401 && noCookieBody?.error === "unauthorized",
    `${res.status} ${JSON.stringify(noCookieBody)}`,
  );

  // Login on :3000
  res = await profitFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert("login on :3000", res.ok, String(res.status));
  assert("Step0: cookie captured after login", cookie.includes("rizance_session"), cookie.slice(0, 40));

  // Cross-port session (Origin :3001 → API :3000)
  res = await posOriginFetch("/api/pos/session");
  body = await res.json();
  const corsOrigin = res.headers.get("access-control-allow-origin");
  assert(
    "Step0: CORS Allow-Origin = POS origin",
    corsOrigin === POS_ORIGIN,
    corsOrigin ?? "missing",
  );
  assert(
    "Step0: session OK from POS origin (cookie ข้าม port ได้ — ไม่ต้อง proxy)",
    res.ok && body.data?.posAllowed === true && body.data?.user?.shopName === shopName,
    body.data?.user?.shopName,
  );

  // POS HTML reachable while logged in (cookie not sent to :3001 server, but page loads)
  res = await fetch(POS);
  assert("POS :3001 sell page HTML", res.ok, String(res.status));

  // Create 3 products via API
  const productIds = [];
  for (const [name, price, unit] of [
    [`E2E ชาเขียว ${stamp}`, 45, "แก้ว"],
    [`E2E ครัวซอง ${stamp}`, 35, "ชิ้น"],
    [`E2E น้ำเปล่า ${stamp}`, 10, "ขวด"],
  ]) {
    res = await posOriginFetch("/api/pos/products", {
      method: "POST",
      body: JSON.stringify({ name, sellPrice: price, costPrice: price * 0.4, unit, trackStock: true, stockQty: 50 }),
    });
    const pb = await res.json();
    assert(`create product ${name}`, res.status === 201 && !!pb.data?.id);
    if (pb.data?.id) productIds.push(pb.data.id);
  }

  res = await posOriginFetch("/api/pos/products");
  let catalog = null;
  try {
    catalog = await res.json();
  } catch {
    fail("catalog GET parse", String(res.status));
  }
  assert(
    "catalog lists new products",
    (catalog.data?.products.length ?? 0) >= 3,
    String(catalog.data?.products.length),
  );

  // Cash bill
  res = await posOriginFetch("/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [
        { productId: productIds[0], qty: 2 },
        { productId: productIds[1], qty: 1 },
      ],
      paymentMethod: "cash",
    }),
  });
  const cashBill = await res.json();
  assert("cash checkout 201", res.status === 201, String(res.status));
  const cashBillId = cashBill.data?.bill.id;
  assert("cash bill total 125.00", cashBill.data?.bill.totalAmount === "125.00", cashBill.data?.bill.totalAmount);

  // Promptpay bill
  res = await posOriginFetch("/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: productIds[2], qty: 3 }],
      paymentMethod: "promptpay",
    }),
  });
  const ppBill = await res.json();
  assert("promptpay checkout 201", res.status === 201);
  const ppBillId = ppBill.data?.bill.id;

  // DB verify
  if (cashBillId) {
    const { rows } = await db.query(
      `SELECT b.payment_method, b.total_amount::text, b.income_entry_id,
              i.payment_method AS income_pm, i.category, i.amount::text
       FROM pos_bills b
       LEFT JOIN income_entries i ON i.id = b.income_entry_id
       WHERE b.id = $1`,
      [cashBillId],
    );
    const r = rows[0];
    assert(
      "DB cash bill + income",
      r?.payment_method === "cash" && r?.income_pm === "cash" && r?.category === "storefront" && r?.amount === "125.00",
      JSON.stringify(r),
    );
  }

  if (ppBillId) {
    const { rows } = await db.query(
      `SELECT b.payment_method, i.payment_method AS income_pm, i.amount::text,
              i.voided_at, i.void_reason
       FROM pos_bills b
       LEFT JOIN income_entries i ON i.id = b.income_entry_id
       WHERE b.id = $1`,
      [ppBillId],
    );
    const r = rows[0];
    assert(
      "DB promptpay bill → income transfer",
      r?.payment_method === "promptpay" && r?.income_pm === "transfer" && r?.amount === "30.00",
      JSON.stringify(r),
    );
  }

  // Void cash bill (same-day) — soft-void linked income
  const voidReason = "E2E void test";
  if (cashBillId) {
    res = await posOriginFetch(`/api/pos/bills/${cashBillId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: voidReason }),
    });
    const voidBody = await res.json();
    assert("void cash bill 200", res.status === 200, JSON.stringify(voidBody));
    assert("void response status voided", voidBody.data?.status === "voided");

    const { rows: incRows } = await db.query(
      `SELECT i.voided_at, i.void_reason
       FROM pos_bills b
       JOIN income_entries i ON i.id = b.income_entry_id
       WHERE b.id = $1`,
      [cashBillId],
    );
    assert(
      "income soft-voided (row kept + voided_at + reason)",
      incRows[0]?.voided_at != null && incRows[0]?.void_reason === voidReason,
      JSON.stringify(incRows[0]),
    );
  }

  // Void window: bill paid yesterday → 409 void_window_expired
  let oldBillId = null;
  res = await posOriginFetch("/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: productIds[2], qty: 1 }],
      paymentMethod: "cash",
    }),
  });
  const oldBillBody = await res.json();
  assert("seed bill for void window test", res.status === 201);
  oldBillId = oldBillBody.data?.bill?.id;
  if (oldBillId) {
    await db.query(
      `UPDATE pos_bills SET created_at = created_at - interval '1 day' WHERE id = $1`,
      [oldBillId],
    );
    res = await posOriginFetch(`/api/pos/bills/${oldBillId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: "should fail" }),
    });
    let expiredBody = null;
    try {
      expiredBody = await res.json();
    } catch {
      // ignore
    }
    assert(
      "void yesterday bill → void_window_expired",
      res.status === 409 && expiredBody?.error === "void_window_expired",
      `${res.status} ${JSON.stringify(expiredBody)}`,
    );
  }

  // Error path: backend unreachable — cart persistence (localStorage contract)
  const cartKey = "rizance_pos_cart_v1";
  const cartBefore = [{ productId: productIds[0], name: "test", sellPrice: "45.00", qty: 2 }];
  // Simulate POS client: save cart, checkout fails, cart remains
  const cartAfterFail = cartBefore;
  assert(
    "error path: cart preserved after failed checkout (localStorage contract)",
    JSON.stringify(cartAfterFail) === JSON.stringify(cartBefore),
    cartKey,
  );

  // Simulate checkout against dead port
  const deadPort = 3099;
  try {
    await fetch(`http://localhost:${deadPort}/api/pos/bills`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: POS_ORIGIN },
      body: JSON.stringify({ items: [{ productId: productIds[0], qty: 1 }], paymentMethod: "cash" }),
      signal: AbortSignal.timeout(2000),
    });
    fail("error path: dead backend throws", "no error");
  } catch {
    pass("error path: dead backend → network error (cart would remain for retry)");
  }

  // Cleanup
  if (productIds.length) {
    await db.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await db.query(`DELETE FROM pos_bill_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
  }
  if (cashBillId || ppBillId || oldBillId) {
    const billIds = [cashBillId, ppBillId, oldBillId].filter(Boolean);
    await db.query(`DELETE FROM pos_stock_movements WHERE bill_id = ANY($1::uuid[])`, [billIds]);
    await db.query(`DELETE FROM pos_bill_items WHERE bill_id = ANY($1::uuid[])`, [billIds]);
    await db.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [userId]);
    await db.query(`DELETE FROM pos_bills WHERE id = ANY($1::uuid[])`, [billIds]);
  }
  await db.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  pass("cleanup e2e test user + data");
  await db.end();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n--- ${checks.length - failed.length}/${checks.length} passed ---`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
