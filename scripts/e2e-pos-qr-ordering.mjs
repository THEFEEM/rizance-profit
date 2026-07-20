/**
 * QR pre-order E2E — ninenon2026@gmail.com menu (8 products, modifiers).
 * Usage: node scripts/e2e-pos-qr-ordering.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const NINENON_EMAIL = "ninenon2026@gmail.com";
const CUSTOMER_NAME = "E2E QR Tester";
const EXPECT_TOTAL = 188; // Crispy 79 + Smash L cheese2 109

const results = [];
function pass(n, d = "") {
  results.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
}
function fail(n, d) {
  results.push({ n, ok: false, d });
  console.log(`FAIL ${n}: ${d}`);
}

function loadEnv() {
  for (const f of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      /* skip */
    }
  }
}

function loadDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  return process.env.DATABASE_URL;
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function makeSessionCookie(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  return {
    name: "rizance_session",
    value: token,
    domain: "localhost",
    path: "/",
  };
}

loadEnv();
const db = new pg.Pool(pgClientOptions(loadDb()));
const userRow = await db.query(
  `SELECT id FROM users WHERE lower(email)=lower($1)`,
  [NINENON_EMAIL],
);
const userId = userRow.rows[0]?.id;
if (!userId) throw new Error(`user not found: ${NINENON_EMAIL}`);

// Clean active orders from prior runs
await db.query(
  `UPDATE pos_orders SET status='cancelled', cancel_reason='e2e cleanup'
   WHERE user_id=$1 AND status IN ('pending','accepted','ready')`,
  [userId],
);
await db.query(
  `UPDATE pos_shop_settings SET online_ordering_enabled=false WHERE user_id=$1`,
  [userId],
);

const sessionCookie = await makeSessionCookie(userId);
const browser = await chromium.launch({ headless: true });
const staffCtx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
await staffCtx.addCookies([sessionCookie]);
const staff = await staffCtx.newPage();
// Warm session cookie against profit origin before POS cross-port API calls.
await staff.goto(`${PROFIT}/home`, { waitUntil: "domcontentloaded", timeout: 45000 });
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guest = await guestCtx.newPage();

let menuToken = null;
let orderNo = null;
let accessToken = null;
let orderId = null;
let billId = null;
let billNo = null;
let dashBefore = null;

try {
  // ── 1) Staff: enable online ordering + get menu link ──
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle", timeout: 45000 });
  await staff.getByRole("button", { name: /QR เมนูร้าน/ }).click();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });

  const toggle = staff.locator('[role="dialog"] input[type="checkbox"]');
  if (!(await toggle.isChecked())) {
    await toggle.click();
    await staff.waitForTimeout(800);
  }

  const settingsRes = await staff.evaluate(async (profit) => {
    const res = await fetch(`${profit}/api/pos/settings`, { credentials: "include" });
    const body = await res.json();
    return { status: res.status, body };
  }, PROFIT);
  if (settingsRes.status !== 200 || !settingsRes.body?.data?.onlineOrderingEnabled) {
    fail("enable_online_ordering", JSON.stringify(settingsRes.body));
  } else {
    menuToken = settingsRes.body.data.publicMenuToken;
    pass("enable_online_ordering", `token=${menuToken?.slice(0, 8)}…`);
  }

  const menuUrl = `${POS}/m/${menuToken}`;
  const linkText = await staff.locator('[role="dialog"]').innerText();
  if (linkText.includes(menuToken)) pass("copy_link_visible", menuUrl);
  else fail("copy_link_visible", "token not in QR sheet");

  // ── 2) Guest: public menu 8 products ──
  await guest.goto(menuUrl, { waitUntil: "networkidle", timeout: 45000 });
  await guest.waitForSelector("header", { timeout: 15000 });
  const menuBody = await guest.locator("main").innerText();
  const productNames = [
    "Smash Homemade S",
    "Smash Homemade M",
    "Smash Homemade L",
    "Beef Burger",
    "Dubble Beef",
    "Chicky Cheese",
    "Crispy Chick",
    "Happy Burger",
  ];
  const found = productNames.filter((n) => menuBody.includes(n));
  if (found.length === 8) pass("menu_8_products", found.join(", "));
  else fail("menu_8_products", `found ${found.length}/8: ${found.join(", ")}`);

  // ── 3) Order Crispy Chick + Smash L cheese2 ──
  await guest.getByText("Crispy Chick").first().click();
  await guest.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const crispySheet = await guest.locator('[role="dialog"]').innerText();
  if (/ต้องเลือก/.test(crispySheet) && /ซอส/.test(crispySheet)) {
    pass("crispy_requires_sauce");
  } else fail("crispy_requires_sauce", crispySheet.slice(0, 200));
  await guest.getByText("Spicy Sauce").click();
  await guest.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await guest.waitForTimeout(400);

  await guest.getByText("Smash Homemade L").first().click();
  await guest.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await guest.getByText("ชีส 2 แผ่น").click();
  const smashPreview = await guest.locator('[role="dialog"]').innerText();
  if (/109(\.00)?/.test(smashPreview)) pass("smash_l_cheese2_109");
  else fail("smash_l_cheese2_109", smashPreview.slice(0, 200));
  await guest.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await guest.waitForTimeout(400);

  await guest.getByRole("button", { name: /ดูตะกร้า/ }).click();
  await guest.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const cartText = await guest.locator('[role="dialog"]').innerText();
  if (/188(\.00)?/.test(cartText)) pass("cart_total_188");
  else fail("cart_total_188", cartText.slice(0, 300).replace(/\n/g, " | "));

  await guest.getByPlaceholder("เช่น น้องเฟม").fill(CUSTOMER_NAME);
  await guest.getByText("หลังเลิกเรียน").click();
  await guest.getByRole("button", { name: /ยืนยันสั่ง/ }).click();
  await guest.waitForURL(/\/o\//, { timeout: 30000 });
  await guest.getByText(/Q\d{6}-\d{3}/).waitFor({ timeout: 15000 });

  const statusBody = await guest.locator("main").innerText();
  const qMatch = statusBody.match(/Q\d{6}-\d{3}/);
  orderNo = qMatch ? qMatch[0] : null;
  accessToken = guest.url().split("/o/")[1]?.split(/[?#]/)[0] ?? null;
  if (orderNo && /รอร้านยืนยัน/.test(statusBody)) {
    pass("order_submitted_queue", `${orderNo} token=${accessToken?.slice(0, 8)}…`);
  } else {
    fail("order_submitted_queue", statusBody.slice(0, 250) || "(empty)");
  }

  const ordRow = await db.query(
    `SELECT id, order_no, total_amount::text, status FROM pos_orders
     WHERE user_id=$1 AND order_no=$2`,
    [userId, orderNo],
  );
  orderId = ordRow.rows[0]?.id;
  if (parseFloat(ordRow.rows[0]?.total_amount) === EXPECT_TOTAL) {
    pass("db_order_total", ordRow.rows[0].total_amount);
  } else {
    fail("db_order_total", JSON.stringify(ordRow.rows[0]));
  }

  // Dashboard baseline
  dashBefore = await staff.evaluate(async ({ profit, today }) => {
    const res = await fetch(`${profit}/api/pos/summary?start=${today}&end=${today}`, {
      credentials: "include",
    });
    const body = await res.json();
    return body?.data?.paidTotal ?? "0";
  }, { profit: PROFIT, today: todayLocal() });

  // ── 4) Staff queue: accept → ready; guest status sync ──
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle" });
  await staff.getByText(orderNo).waitFor({ timeout: 25000 });
  pass("staff_sees_order", orderNo);

  await staff.getByRole("button", { name: "รับออเดอร์" }).first().click();
  await staff.waitForTimeout(1500);

  let guestAccepted = false;
  for (let i = 0; i < 6; i++) {
    await guest.reload({ waitUntil: "networkidle" });
    const t = await guest.locator("main").innerText();
    if (/ร้านรับออเดอร์แล้ว|กำลังทำ/.test(t)) {
      guestAccepted = true;
      break;
    }
    await guest.waitForTimeout(2000);
  }
  if (guestAccepted) pass("guest_status_accepted");
  else fail("guest_status_accepted", await guest.locator("main").innerText());

  await staff.getByRole("button", { name: "พร้อมรับ" }).first().click();
  await staff.waitForTimeout(1500);

  let guestReady = false;
  for (let i = 0; i < 6; i++) {
    await guest.reload({ waitUntil: "networkidle" });
    const t = await guest.locator("main").innerText();
    if (/พร้อมรับ/.test(t)) {
      guestReady = true;
      break;
    }
    await guest.waitForTimeout(2000);
  }
  if (guestReady) pass("guest_status_ready");
  else fail("guest_status_ready", await guest.locator("main").innerText());

  // ── 5) Collect cash 200 → close bill ──
  await staff.getByRole("button", { name: /เก็บเงิน/ }).first().click();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await staff.locator('[role="dialog"] input[inputmode="decimal"]').fill("200");
  const payDialog = await staff.locator('[role="dialog"]').innerText();
  const change = 200 - EXPECT_TOTAL;
  if (new RegExp(String(change)).test(payDialog)) pass("cash_change", `${change} baht`);
  else fail("cash_change", payDialog.slice(0, 200));

  await staff.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await staff.waitForTimeout(2500);

  const queueAfterPay = await staff.locator("main").innerText();
  if (!queueAfterPay.includes(orderNo)) pass("order_removed_from_queue");
  else fail("order_removed_from_queue", "still visible");

  const billRow = await db.query(
    `SELECT o.bill_id, b.bill_no, b.total_amount::text, b.status
     FROM pos_orders o
     LEFT JOIN pos_bills b ON b.id = o.bill_id
     WHERE o.id = $1`,
    [orderId],
  );
  billId = billRow.rows[0]?.bill_id;
  billNo = billRow.rows[0]?.bill_no;
  if (billId && billRow.rows[0]?.status === "paid") {
    pass("order_linked_bill", `${billNo} bill_id=${billId.slice(0, 8)}…`);
  } else {
    fail("order_linked_bill", JSON.stringify(billRow.rows[0]));
  }

  await staff.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  const hist = await staff.locator("main").innerText();
  if (hist.includes(billNo)) pass("bill_in_history", billNo);
  else fail("bill_in_history", "bill not listed");

  await staff.goto(`${POS}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await staff.waitForTimeout(1000);
  const dashAfter = await staff.evaluate(async ({ profit, today }) => {
    const res = await fetch(`${profit}/api/pos/summary?start=${today}&end=${today}`, {
      credentials: "include",
    });
    const body = await res.json();
    return body?.data?.paidTotal ?? "0";
  }, { profit: PROFIT, today: todayLocal() });
  const beforeN = parseFloat(dashBefore);
  const afterN = parseFloat(dashAfter);
  if (Math.abs(afterN - beforeN - EXPECT_TOTAL) < 0.01) {
    pass("dashboard_total_up", `${beforeN} → ${afterN}`);
  } else {
    fail("dashboard_total_up", `${beforeN} → ${afterN} (expected +${EXPECT_TOTAL})`);
  }

  // ── 6) Journal balanced ──
  const journal = await db.query(
    `SELECT
       COALESCE(SUM(jl.debit),0)::text AS sum_debit,
       COALESCE(SUM(jl.credit),0)::text AS sum_credit,
       COALESCE(SUM(CASE WHEN jl.account_code IN ('1000','1010') THEN jl.debit ELSE 0 END),0)::text AS cash_debit,
       COALESCE(SUM(CASE WHEN jl.account_code = '4000' THEN jl.credit ELSE 0 END),0)::text AS revenue_credit
     FROM journal_entries je
     JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE je.user_id = $1 AND je.source_module = 'pos'
       AND je.source_event_id = $2 AND je.source_event_type = 'pos_bill_paid'`,
    [userId, billId],
  );
  const total = billRow.rows[0]?.total_amount;
  const { sum_debit, sum_credit, cash_debit, revenue_credit } = journal.rows[0] ?? {};
  const balanced = parseFloat(sum_debit) === parseFloat(sum_credit);
  const revenueOk =
    parseFloat(cash_debit) === parseFloat(total) &&
    parseFloat(revenue_credit) === parseFloat(total);
  if (balanced && revenueOk) {
    pass("journal_balanced", `debit=credit=${sum_debit}; cash/revenue=${cash_debit}`);
  } else {
    fail("journal_balanced", JSON.stringify(journal.rows[0]));
  }

  const journalCountBeforeCancel = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const incomeCountBeforeCancel = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );

  // ── 7) Disable ordering → guest sees closed ──
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle" });
  await staff.getByRole("button", { name: /QR เมนูร้าน/ }).click();
  const toggleOff = staff.locator('[role="dialog"] input[type="checkbox"]');
  if (await toggleOff.isChecked()) await toggleOff.click();
  await staff.waitForTimeout(800);
  pass("disable_online_ordering");

  await guest.goto(`${menuUrl}?t=${Date.now()}`, { waitUntil: "networkidle" });
  const closedText = await guest.locator("main").innerText();
  if (/ร้านยังไม่เปิดรับออเดอร์/.test(closedText)) pass("menu_closed_message");
  else fail("menu_closed_message", closedText.slice(0, 200));

  // Re-enable for cancel test order via API
  await staff.evaluate(async (profit) => {
    await fetch(`${profit}/api/pos/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlineOrderingEnabled: true }),
    });
  }, PROFIT);

  // ── 8) Cancel order — no journal/income ──
  const menuRes = await fetch(`${PROFIT}/api/public/menu/${menuToken}`);
  const menuData = await menuRes.json();
  const productId = menuData.data.catalog.products.find((p) => p.name.includes("Beef Burger"))?.id;
  if (!productId) throw new Error("Beef Burger not in catalog");

  const cancelOrderRes = await fetch(`${PROFIT}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: menuToken,
      customerName: "Cancel Me",
      items: [{ productId, qty: 1 }],
    }),
  });
  const cancelOrderBody = await cancelOrderRes.json();
  const cancelOrderId = (
    await db.query(`SELECT id FROM pos_orders WHERE access_token=$1`, [
      cancelOrderBody.data.accessToken,
    ])
  ).rows[0]?.id;

  await staff.reload({ waitUntil: "networkidle" });
  await staff.waitForTimeout(1000);
  const cancelCard = staff.locator("li").filter({ hasText: cancelOrderBody.data.orderNo });
  await cancelCard.getByRole("button", { name: new RegExp(`ยกเลิก ${cancelOrderBody.data.orderNo}`) }).click();
  await staff.waitForTimeout(1500);

  const cancelled = await db.query(`SELECT status FROM pos_orders WHERE id=$1`, [cancelOrderId]);
  if (cancelled.rows[0]?.status === "cancelled") pass("cancel_order_status");
  else fail("cancel_order_status", JSON.stringify(cancelled.rows[0]));

  const journalCountAfter = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const incomeCountAfter = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );
  if (
    journalCountAfter.rows[0].n === journalCountBeforeCancel.rows[0].n &&
    incomeCountAfter.rows[0].n === incomeCountBeforeCancel.rows[0].n
  ) {
    pass("cancel_no_accounting", `journal=${journalCountAfter.rows[0].n} income=${incomeCountAfter.rows[0].n}`);
  } else {
    fail(
      "cancel_no_accounting",
      `journal ${journalCountBeforeCancel.rows[0].n}→${journalCountAfter.rows[0].n}, income ${incomeCountBeforeCancel.rows[0].n}→${incomeCountAfter.rows[0].n}`,
    );
  }
} catch (err) {
  fail("uncaught", err?.message ?? String(err));
} finally {
  await db.query(
    `UPDATE pos_shop_settings SET online_ordering_enabled=false WHERE user_id=$1`,
    [userId],
  );
  await browser.close();
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.error("Failures:", failed.map((f) => `${f.n}: ${f.d}`).join("\n"));
  process.exit(1);
}
