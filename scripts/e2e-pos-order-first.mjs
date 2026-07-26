/**
 * Order-first flow E2E (checklist a–g)
 * Usage: node scripts/e2e-pos-order-first.mjs
 * Requires: profit :3000, pos :3001
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
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      /* skip */
    }
  }
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

async function dismissOverlays(page) {
  for (const re of [/เก็บเงินตอนลูกค้ามารับ/, /รับเงินแล้ว|เงินทอน/]) {
    const ov = page.locator("button.fixed").filter({ hasText: re }).first();
    if (await ov.isVisible().catch(() => false)) {
      await ov.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

async function setKitchenEnabled(page, enabled) {
  await page.goto(`${POS}/orders`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button", { name: /QR เมนูร้าน/ }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const kitchenSwitch = page
    .locator('[role="dialog"] label')
    .filter({ hasText: /เปิดจอครัว/ })
    .locator('input[type="checkbox"]');
  const checked = await kitchenSwitch.isChecked();
  if (checked !== enabled) {
    await kitchenSwitch.click();
    await page.waitForTimeout(900);
  }
  await page.keyboard.press("Escape").catch(() => {});
  const settings = await page.evaluate(async (profit) => {
    const res = await fetch(`${profit}/api/pos/settings`, { credentials: "include" });
    return res.json();
  }, PROFIT);
  return settings?.data?.kitchenEnabled === enabled;
}

/** Add product; if modifier sheet opens, pick first option matching pattern (or first clickable option). */
async function addProduct(page, name, { pickModifier = null, skipModifierConfirm = false } = {}) {
  await page.getByText(name).first().click();
  await page.waitForTimeout(400);
  const dialog = page.locator('[role="dialog"]');
  if (!(await dialog.isVisible().catch(() => false))) return;
  if (pickModifier) {
    const opt = dialog.getByText(pickModifier).first();
    if (await opt.isVisible().catch(() => false)) await opt.click();
  } else if (!skipModifierConfirm) {
    // optional groups — may confirm empty if minSelect=0
  }
  if (skipModifierConfirm) {
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }
  const addBtn = dialog.getByRole("button", { name: /ใส่ตะกร้า|บันทึก|ยืนยัน/ });
  if (await addBtn.isVisible().catch(() => false)) {
    const disabled = await addBtn.isDisabled().catch(() => false);
    if (!disabled) await addBtn.click();
    else await page.keyboard.press("Escape").catch(() => {});
  }
  await page.waitForTimeout(400);
}

loadEnv();
const db = new pg.Pool(pgClientOptions(process.env.DATABASE_URL));
const userRow = await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [
  NINENON_EMAIL,
]);
const userId = userRow.rows[0]?.id;
if (!userId) throw new Error(`user not found: ${NINENON_EMAIL}`);

await db.query(
  `UPDATE pos_orders SET status='cancelled', cancel_reason='order-first e2e cleanup'
   WHERE user_id=$1 AND status IN ('pending','accepted','cooking','ready')`,
  [userId],
);

const sessionCookie = await makeSessionCookie(userId);
const browser = await chromium.launch({ headless: true });
const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await staffCtx.addCookies([sessionCookie]);
const staff = await staffCtx.newPage();
const kitchen = await staffCtx.newPage();

let orderNo = null;
let orderId = null;
let productIds = [];

try {
  await staff.goto(`${PROFIT}/home`, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Resolve product ids + stock baseline for Smash L + Beef
  const products = await db.query(
    `SELECT id, name, stock_qty::text, track_stock
     FROM pos_products
     WHERE user_id=$1 AND name IN ('Smash Homemade L (เนื้อ 80g)', 'Beef Burger', 'Crispy Chick')
        OR (user_id=$1 AND name LIKE 'Smash Homemade L%')
        OR (user_id=$1 AND name LIKE 'Beef Burger%')
        OR (user_id=$1 AND name LIKE 'Crispy Chick%')`,
    [userId],
  );
  const byName = Object.fromEntries(products.rows.map((r) => [r.name, r]));
  const smash =
    products.rows.find((r) => r.name.startsWith("Smash Homemade L")) ?? null;
  const beef = products.rows.find((r) => r.name.startsWith("Beef Burger")) ?? null;
  const crispy = products.rows.find((r) => r.name.startsWith("Crispy Chick")) ?? null;
  if (!smash || !beef || !crispy) {
    throw new Error(`products missing: ${products.rows.map((r) => r.name).join(", ")}`);
  }
  productIds = [smash.id, beef.id];

  const stockBeforeCreate = await db.query(
    `SELECT id, stock_qty::text FROM pos_products WHERE id = ANY($1::uuid[])`,
    [productIds],
  );
  const stockMapBefore = Object.fromEntries(
    stockBeforeCreate.rows.map((r) => [r.id, r.stock_qty]),
  );

  const incomeBefore = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );
  const journalBefore = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const stockMoveBefore = await db.query(
    `SELECT count(*)::int AS n FROM pos_stock_movements WHERE user_id=$1`,
    [userId],
  );

  // ── a) Sell page: 2 items + 1 modifier → สร้าง Order ──
  await staff.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await staff.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await staff.reload({ waitUntil: "networkidle" });
  await staff.getByText(/Smash Homemade L/).first().waitFor({ timeout: 20000 });

  // Smash L + cheese — optional group: long-press opens modifier sheet
  const smashTile = staff
    .locator("button")
    .filter({ hasText: /Smash Homemade L/ })
    .first();
  await smashTile.waitFor({ timeout: 20000 });
  const box = await smashTile.boundingBox();
  if (!box) throw new Error("smash tile no box");
  await staff.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await staff.mouse.down();
  await staff.waitForTimeout(550);
  await staff.mouse.up();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await staff.getByText("ชีส 2 แผ่น").click();
  await staff.getByRole("button", { name: /ใส่ตะกร้า/ }).click();
  await staff.waitForTimeout(500);

  // Beef Burger — tap add (or sheet)
  await staff.getByText("Beef Burger").first().click();
  await staff.waitForTimeout(500);
  const beefDialog = staff.locator('[role="dialog"]');
  if (await beefDialog.isVisible().catch(() => false)) {
    const addBtn = beefDialog.getByRole("button", { name: /ใส่ตะกร้า/ });
    if ((await addBtn.isVisible().catch(() => false)) && !(await addBtn.isDisabled())) {
      await addBtn.click();
    } else {
      await staff.keyboard.press("Escape").catch(() => {});
    }
  }
  await staff.waitForTimeout(400);

  // Ensure cart sheet open on narrow layouts
  const createBtn = staff.getByRole("button", { name: "สร้าง Order" });
  if (!(await createBtn.isVisible().catch(() => false))) {
    const cartFab = staff.getByRole("button", { name: /ตะกร้า|สร้าง Order/ }).first();
    if (await cartFab.isVisible().catch(() => false)) await cartFab.click();
    await staff.waitForTimeout(400);
  }

  const mainBtn = staff.getByRole("button", { name: "สร้าง Order" });
  if ((await mainBtn.count()) > 0) pass("a_primary_create_order");
  else fail("a_primary_create_order", await staff.locator("body").innerText());

  const payLater = staff.getByRole("button", { name: /จ่ายเลย \(ไม่เข้าคิว\)/ });
  if ((await payLater.count()) > 0) pass("a_secondary_pay_now_visible");
  else fail("a_secondary_pay_now_visible", "missing");

  const cartSnap = await staff.evaluate(() => {
    const cart = JSON.parse(localStorage.getItem("rizance_pos_cart_v2") || "[]");
    return {
      lines: cart.length,
      mods: cart.flatMap((l) => (l.modifiers || []).map((m) => m.name || m.id)),
      raw: cart,
    };
  });
  if (cartSnap.lines >= 2) pass("a_cart_2_items", `lines=${cartSnap.lines}`);
  else fail("a_cart_2_items", JSON.stringify(cartSnap));

  if (cartSnap.mods.length > 0) pass("a_has_modifier", cartSnap.mods.join(", "));
  else fail("a_has_modifier", JSON.stringify(cartSnap.raw).slice(0, 300));

  await Promise.all([
    staff.waitForResponse(
      (r) =>
        r.url().includes("/api/pos/orders") &&
        r.request().method() === "POST" &&
        r.status() < 500,
      { timeout: 20000 },
    ),
    mainBtn.click(),
  ]);

  const overlay = staff.locator("button.fixed").filter({ hasText: /เก็บเงินตอนลูกค้ามารับ/ });
  await overlay.waitFor({ state: "visible", timeout: 15000 });
  const ovText = await overlay.innerText();
  const qMatch = ovText.match(/Q\d{6}-\d{3}/);
  orderNo = qMatch?.[0] ?? null;
  if (orderNo && /\d{3}/.test(ovText)) pass("a_queue_overlay", orderNo);
  else fail("a_queue_overlay", ovText.slice(0, 200));

  await staff.waitForTimeout(500);
  const cartAfter = await staff.evaluate(
    () => JSON.parse(localStorage.getItem("rizance_pos_cart_v2") || "[]").length,
  );
  if (cartAfter === 0) pass("a_cart_cleared");
  else fail("a_cart_cleared", `cart=${cartAfter}`);

  // stock/income unchanged at create
  const stockAfterCreate = await db.query(
    `SELECT id, stock_qty::text FROM pos_products WHERE id = ANY($1::uuid[])`,
    [productIds],
  );
  const stockSame = stockAfterCreate.rows.every(
    (r) => r.stock_qty === stockMapBefore[r.id],
  );
  const incomeMid = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );
  const journalMid = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const moveMid = await db.query(
    `SELECT count(*)::int AS n FROM pos_stock_movements WHERE user_id=$1`,
    [userId],
  );
  if (
    stockSame &&
    incomeMid.rows[0].n === incomeBefore.rows[0].n &&
    journalMid.rows[0].n === journalBefore.rows[0].n &&
    moveMid.rows[0].n === stockMoveBefore.rows[0].n
  ) {
    pass("a_no_stock_money_on_create");
  } else {
    fail(
      "a_no_stock_money_on_create",
      `stockSame=${stockSame} income ${incomeBefore.rows[0].n}→${incomeMid.rows[0].n}`,
    );
  }

  const ord = await db.query(
    `SELECT id, status, channel, bill_id, customer_name FROM pos_orders
     WHERE user_id=$1 AND order_no=$2`,
    [userId, orderNo],
  );
  orderId = ord.rows[0]?.id;
  if (
    ord.rows[0]?.status === "accepted" &&
    ord.rows[0]?.channel === "pos" &&
    !ord.rows[0]?.bill_id
  ) {
    pass("a_db_unpaid_staff_order", JSON.stringify(ord.rows[0]));
  } else {
    fail("a_db_unpaid_staff_order", JSON.stringify(ord.rows[0]));
  }

  await dismissOverlays(staff);

  // ── b) Orders tab + kitchen ──
  await kitchen.goto(`${POS}/kitchen`, { waitUntil: "networkidle", timeout: 45000 });
  await kitchen.click("body", { position: { x: 10, y: 10 } });

  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle", timeout: 45000 });
  await staff.getByText(orderNo).waitFor({ timeout: 15000 });
  const ordersText = await staff.locator("main").innerText();
  if (/รอทำ/.test(ordersText) && /หน้าร้าน/.test(ordersText) && /เริ่มทำ/.test(ordersText)) {
    pass("b_orders_badge_wait_start");
  } else {
    fail("b_orders_badge_wait_start", ordersText.slice(0, 400).replace(/\n/g, " | "));
  }

  await kitchen.reload({ waitUntil: "networkidle" });
  let kitchenOk = false;
  for (let i = 0; i < 8; i++) {
    const kt = await kitchen.locator("main").innerText();
    if (kt.includes(orderNo) && /\d:\d{2}/.test(kt)) {
      kitchenOk = true;
      break;
    }
    await kitchen.waitForTimeout(1500);
    await kitchen.reload({ waitUntil: "networkidle" }).catch(() => {});
  }
  if (kitchenOk) pass("b_kitchen_same_ticket_timer", orderNo);
  else fail("b_kitchen_same_ticket_timer", await kitchen.locator("main").innerText());

  // ── c) cooking → ready → เก็บเงิน (not ส่งมอบ) ──
  await kitchen.getByRole("button", { name: /เริ่มทำ/ }).first().click();
  await kitchen.waitForTimeout(1000);
  await kitchen.getByRole("button", { name: /เสร็จแล้ว/ }).first().click();
  await kitchen.waitForTimeout(1000);

  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle" });
  await staff.getByText(orderNo).waitFor({ timeout: 15000 });
  const collectBtn = staff.getByRole("button", { name: /เก็บเงิน ฿/ });
  const handoffBtn = staff.getByRole("button", { name: /ส่งมอบแล้ว/ });
  if ((await collectBtn.count()) > 0 && (await handoffBtn.count()) === 0) {
    pass("c_collect_not_handoff", await collectBtn.first().innerText());
  } else {
    fail(
      "c_collect_not_handoff",
      `collect=${await collectBtn.count()} handoff=${await handoffBtn.count()}`,
    );
  }

  await collectBtn.first().click();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await staff.locator('[role="dialog"] input[inputmode="decimal"]').fill("500");
  await staff.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await staff
    .getByText(/ปิดบิล|เก็บเงิน/)
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await staff.waitForTimeout(1500);
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle" });
  await staff.waitForTimeout(800);

  const queueText = await staff.locator("main").innerText();
  const gone = !queueText.includes(orderNo);
  const afterPay = await db.query(
    `SELECT status, bill_id FROM pos_orders WHERE id=$1`,
    [orderId],
  );
  if (gone && afterPay.rows[0]?.status === "completed" && afterPay.rows[0]?.bill_id) {
    pass("c_paid_removed_from_queue");
  } else {
    fail(
      "c_paid_removed_from_queue",
      `gone=${gone} db=${JSON.stringify(afterPay.rows[0])} ui=${queueText.slice(0, 200)}`,
    );
  }

  // ── d) DB: bill_id, journal, stock cut at close ──
  const billId = afterPay.rows[0]?.bill_id;
  const journal = await db.query(
    `SELECT
       COALESCE(SUM(jl.debit),0)::text AS sum_debit,
       COALESCE(SUM(jl.credit),0)::text AS sum_credit
     FROM journal_entries je
     JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE je.user_id=$1 AND je.source_module='pos'
       AND je.source_event_id=$2 AND je.source_event_type='pos_bill_paid'`,
    [userId, billId],
  );
  const bal =
    parseFloat(journal.rows[0]?.sum_debit) === parseFloat(journal.rows[0]?.sum_credit) &&
    parseFloat(journal.rows[0]?.sum_debit) > 0;
  if (bal) pass("d_journal_balanced", JSON.stringify(journal.rows[0]));
  else fail("d_journal_balanced", JSON.stringify(journal.rows[0]));

  const stockAfterPay = await db.query(
    `SELECT id, stock_qty::text, track_stock FROM pos_products WHERE id = ANY($1::uuid[])`,
    [productIds],
  );
  const moves = await db.query(
    `SELECT product_id, qty_change::text FROM pos_stock_movements
     WHERE user_id=$1 AND bill_id=$2 AND movement_type='sale'`,
    [userId, billId],
  );
  const trackedCut = stockAfterPay.rows
    .filter((r) => r.track_stock)
    .every((r) => parseFloat(r.stock_qty) < parseFloat(stockMapBefore[r.id]));
  if (moves.rowCount > 0 || trackedCut) {
    pass(
      "d_stock_cut_at_close",
      `moves=${moves.rowCount} trackedCut=${trackedCut}`,
    );
  } else if (stockAfterPay.rows.every((r) => !r.track_stock)) {
    pass("d_stock_cut_at_close", "no track_stock products — N/A ok");
  } else {
    fail("d_stock_cut_at_close", JSON.stringify({ stockAfterPay: stockAfterPay.rows, moves: moves.rows }));
  }

  // ── e) Crispy without sauce → error, no order ──
  await staff.goto(POS, { waitUntil: "networkidle" });
  // Inject cart line without required modifier
  await staff.evaluate((pid) => {
    const cart = [
      {
        productId: pid,
        name: "Crispy Chick",
        sellPrice: "79",
        qty: 1,
      },
    ];
    localStorage.setItem("rizance_pos_cart_v2", JSON.stringify(cart));
  }, crispy.id);
  await staff.reload({ waitUntil: "networkidle" });
  const ordersBeforeE = await db.query(
    `SELECT count(*)::int AS n FROM pos_orders WHERE user_id=$1 AND status IN ('pending','accepted','cooking','ready')`,
    [userId],
  );

  const createE = staff.getByRole("button", { name: "สร้าง Order" });
  if (!(await createE.isVisible().catch(() => false))) {
    await staff.getByRole("button", { name: /ตะกร้า|สร้าง Order/ }).first().click();
  }
  await staff.getByRole("button", { name: "สร้าง Order" }).click();
  await staff.waitForTimeout(1500);
  const toastOrBody = await staff.locator("body").innerText();
  const errOk = /มีรายการที่ต้องเลือกตัวเลือกก่อน/.test(toastOrBody);
  const ordersAfterE = await db.query(
    `SELECT count(*)::int AS n FROM pos_orders WHERE user_id=$1 AND status IN ('pending','accepted','cooking','ready')`,
    [userId],
  );
  if (errOk && ordersAfterE.rows[0].n === ordersBeforeE.rows[0].n) {
    pass("e_modifier_required_error");
  } else {
    fail(
      "e_modifier_required_error",
      `errOk=${errOk} orders ${ordersBeforeE.rows[0].n}→${ordersAfterE.rows[0].n} body=${toastOrBody.slice(0, 250)}`,
    );
  }

  // ── f) จ่ายเลย with kitchen on → paid kitchen ticket ──
  await setKitchenEnabled(staff, true);
  await staff.goto(POS, { waitUntil: "networkidle" });
  await staff.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await staff.reload({ waitUntil: "networkidle" });
  await addProduct(staff, "Beef Burger");
  // ensure cart has item
  let lines = await staff.evaluate(() =>
    JSON.parse(localStorage.getItem("rizance_pos_cart_v2") || "[]").length,
  );
  if (lines < 1) {
    await staff.evaluate((pid) => {
      localStorage.setItem(
        "rizance_pos_cart_v2",
        JSON.stringify([{ productId: pid, name: "Beef Burger", sellPrice: "89", qty: 1 }]),
      );
    }, beef.id);
    await staff.reload({ waitUntil: "networkidle" });
  }

  const payNow = staff.getByRole("button", { name: /จ่ายเลย \(ไม่เข้าคิว\)/ });
  if (!(await payNow.isVisible().catch(() => false))) {
    await staff.getByRole("button", { name: /ตะกร้า|สร้าง Order/ }).first().click();
  }
  await staff.getByRole("button", { name: /จ่ายเลย \(ไม่เข้าคิว\)/ }).click();
  await staff.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await staff.getByRole("button", { name: "เงินสด", exact: true }).click();
  await staff.getByLabel("รับเงินมา").fill("500");
  await staff.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await staff.getByText(/รับเงินแล้ว|เงินทอน/).first().waitFor({ timeout: 20000 });
  pass("f_pay_now_checkout_ok");
  await dismissOverlays(staff);

  // kitchen ticket from paid bill (customer_name like หน้าร้าน BILL…)
  let paidTicket = null;
  for (let i = 0; i < 12; i++) {
    const t = await db.query(
      `SELECT id, order_no, bill_id, customer_name, status
       FROM pos_orders
       WHERE user_id=$1 AND channel='pos' AND bill_id IS NOT NULL
         AND status IN ('accepted','cooking','ready')
         AND customer_name LIKE 'หน้าร้าน %'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (t.rows[0]) {
      paidTicket = t.rows[0];
      break;
    }
    await staff.waitForTimeout(1000);
  }
  if (paidTicket?.bill_id) pass("f_kitchen_ticket_when_enabled", paidTicket.order_no);
  else fail("f_kitchen_ticket_when_enabled", "no paid kitchen ticket");

  // cleanup paid ticket
  if (paidTicket) {
    await db.query(
      `UPDATE pos_orders SET status='cancelled', cancel_reason='e2e f cleanup' WHERE id=$1`,
      [paidTicket.id],
    );
  }

  // ── g) cancel unpaid order — no money/stock change ──
  await staff.goto(POS, { waitUntil: "networkidle" });
  await staff.evaluate((pid) => {
    localStorage.setItem(
      "rizance_pos_cart_v2",
      JSON.stringify([{ productId: pid, name: "Beef Burger", sellPrice: "89", qty: 1 }]),
    );
  }, beef.id);
  await staff.reload({ waitUntil: "networkidle" });
  if (!(await staff.getByRole("button", { name: "สร้าง Order" }).isVisible().catch(() => false))) {
    await staff.getByRole("button", { name: /ตะกร้า|สร้าง Order/ }).first().click();
  }
  await staff.getByRole("button", { name: "สร้าง Order" }).click();
  await staff
    .locator("button.fixed")
    .filter({ hasText: /เก็บเงินตอนลูกค้ามารับ/ })
    .waitFor({ state: "visible", timeout: 15000 });
  const gText = await staff.locator("button.fixed").filter({ hasText: /Q\d{6}/ }).innerText();
  const gNo = (gText.match(/Q\d{6}-\d{3}/) || [])[0];
  await dismissOverlays(staff);

  const gRow = await db.query(
    `SELECT id FROM pos_orders WHERE user_id=$1 AND order_no=$2`,
    [userId, gNo],
  );
  const gId = gRow.rows[0]?.id;

  const incomeG0 = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );
  const journalG0 = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const moveG0 = await db.query(
    `SELECT count(*)::int AS n FROM pos_stock_movements WHERE user_id=$1`,
    [userId],
  );
  const stockG0 = await db.query(
    `SELECT stock_qty::text FROM pos_products WHERE id=$1`,
    [beef.id],
  );

  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle" });
  await staff.getByText(gNo).waitFor({ timeout: 15000 });
  await staff
    .locator("li")
    .filter({ hasText: gNo })
    .getByRole("button", { name: /ยกเลิก/ })
    .click();
  await staff.waitForTimeout(1200);

  const gStatus = await db.query(`SELECT status FROM pos_orders WHERE id=$1`, [gId]);
  const incomeG1 = await db.query(
    `SELECT count(*)::int AS n FROM income_entries WHERE user_id=$1`,
    [userId],
  );
  const journalG1 = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE user_id=$1`,
    [userId],
  );
  const moveG1 = await db.query(
    `SELECT count(*)::int AS n FROM pos_stock_movements WHERE user_id=$1`,
    [userId],
  );
  const stockG1 = await db.query(
    `SELECT stock_qty::text FROM pos_products WHERE id=$1`,
    [beef.id],
  );

  if (
    gStatus.rows[0]?.status === "cancelled" &&
    incomeG1.rows[0].n === incomeG0.rows[0].n &&
    journalG1.rows[0].n === journalG0.rows[0].n &&
    moveG1.rows[0].n === moveG0.rows[0].n &&
    stockG1.rows[0].stock_qty === stockG0.rows[0].stock_qty
  ) {
    pass("g_cancel_no_side_effects", gNo);
  } else {
    fail(
      "g_cancel_no_side_effects",
      JSON.stringify({
        status: gStatus.rows[0],
        income: [incomeG0.rows[0].n, incomeG1.rows[0].n],
        journal: [journalG0.rows[0].n, journalG1.rows[0].n],
        moves: [moveG0.rows[0].n, moveG1.rows[0].n],
        stock: [stockG0.rows[0].stock_qty, stockG1.rows[0].stock_qty],
      }),
    );
  }
} catch (err) {
  fail("fatal", err?.stack || String(err));
} finally {
  await browser.close();
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log("\n── summary ──");
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.n}${r.d ? ` — ${r.d}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
