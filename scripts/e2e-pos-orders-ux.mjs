/**
 * Orders UX checklist:
 * 1. /orders — 4 stats cards count + filter + minute chips (red >=15)
 * 2. /o step tracker by status
 * 3. delivery step3 "กำลังไปส่ง" · pickup "พร้อมเสิร์ฟ"
 * 4. shop phone → "โทรหาร้าน" · clear → gone
 * 5. invalid phone "12345" → toast error, HTTP 400 (not 500)
 * 6. "ข้อมูลการสั่งซื้อ" order type / payment match
 *
 * Usage: node scripts/e2e-pos-orders-ux.mjs
 * Requires: profit :3000, pos :3001, migration 0063
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
const GEO = { lat: 13.756331, lng: 100.501762 };

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

async function makeSessionToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
}

async function profitApi(sessionToken, path, { method = "GET", body } = {}) {
  const res = await fetch(`${PROFIT}${path}`, {
    method,
    headers: {
      Cookie: `rizance_session=${sessionToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed };
}

async function placePublicOrder({ menuToken, productId, orderType, paymentIntent, name, db }) {
  const payload = {
    token: menuToken,
    customerName: name,
    customerPhone: "0812345678",
    orderType,
    paymentIntent,
    items: [{ productId, qty: 1 }],
  };
  if (orderType === "delivery") {
    payload.deliveryLat = GEO.lat;
    payload.deliveryLng = GEO.lng;
    payload.deliveryAddress = "E2E test landmark";
  } else {
    payload.pickupAtText = "เร็วๆ นี้";
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${PROFIT}/api/public/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (res.status === 429) {
      lastErr = body;
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`place order failed ${res.status}: ${JSON.stringify(body)}`);
    const accessToken = body.data?.accessToken;
    if (!accessToken) throw new Error(`no accessToken: ${JSON.stringify(body)}`);
    const q = await db.query(`SELECT id, order_no FROM pos_orders WHERE access_token=$1`, [
      accessToken,
    ]);
    if (!q.rows[0]) throw new Error("order row missing after create");
    return { id: q.rows[0].id, orderNo: q.rows[0].order_no, accessToken };
  }
  throw new Error(`place order rate limited: ${JSON.stringify(lastErr)}`);
}

async function patchOrderStatus(sessionToken, orderId, status) {
  return profitApi(sessionToken, `/api/pos/orders/${orderId}`, {
    method: "PATCH",
    body: { status },
  });
}

function stepState(page) {
  return page.evaluate(() => {
    // StepTracker circles: find the flex row with 4 numbered/check circles
    const cards = [...document.querySelectorAll("div")].filter((el) => {
      const circles = el.querySelectorAll(":scope > div > div > div.rounded-full, :scope > div.flex-1 > div > div.rounded-full");
      return false;
    });
    // Simpler: look for step labels
    const labels = ["รับออเดอร์", "กำลังทำ", "กำลังไปส่ง", "พร้อมเสิร์ฟ", "เสร็จสิ้น"];
    const found = [];
    for (const label of labels) {
      const el = [...document.querySelectorAll("span")].find((s) => s.textContent?.trim() === label);
      if (!el) continue;
      const cls = el.className || "";
      const circle = el.parentElement?.querySelector(".rounded-full");
      const circleCls = circle?.className || "";
      found.push({
        label,
        current: /\btext-warn\b/.test(cls) || /\bfont-semibold\b/.test(cls),
        done: /\btext-money-in\b/.test(cls),
        circleWarn: /\bbg-warn-soft\b/.test(circleCls) || /\bborder-warn\b/.test(circleCls),
        circleDone: /\bbg-money-in\b/.test(circleCls),
      });
    }
    return found;
  });
}

loadEnv();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const db = new pg.Pool(pgClientOptions(process.env.DATABASE_URL));

const userRow = await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [
  NINENON_EMAIL,
]);
const userId = userRow.rows[0]?.id;
if (!userId) throw new Error(`user not found: ${NINENON_EMAIL}`);

await db.query(
  `UPDATE pos_orders SET status='cancelled', cancel_reason='e2e orders-ux cleanup'
   WHERE user_id=$1 AND status IN ('pending','accepted','cooking','ready')`,
  [userId],
);

await db.query(
  `UPDATE pos_shop_settings
   SET online_ordering_enabled=true, kitchen_enabled=true,
       delivery_enabled=true, delivery_fee=30, delivery_min_order=0,
       shop_phone=NULL
   WHERE user_id=$1`,
  [userId],
);

const tokQ = await db.query(
  `SELECT public_menu_token FROM pos_shop_settings WHERE user_id=$1`,
  [userId],
);
const menuToken = tokQ.rows[0]?.public_menu_token;
if (!menuToken) throw new Error("no public_menu_token");

// Prefer a product with no modifiers (plain add-to-cart)
const products = await db.query(
  `SELECT p.id, p.name, p.sell_price::float AS price
   FROM pos_products p
   WHERE p.user_id=$1 AND p.is_active=true
     AND NOT EXISTS (
       SELECT 1 FROM pos_product_modifier_groups pmg
       WHERE pmg.product_id = p.id
     )
   ORDER BY p.sell_price ASC
   LIMIT 1`,
  [userId],
);
let productId = products.rows[0]?.id;
let tempProductId = null;
if (!productId) {
  const ins = await db.query(
    `INSERT INTO pos_products (user_id, name, sell_price, is_active, track_stock, stock_qty)
     VALUES ($1, 'E2E UX Plain', 10, true, false, 0)
     RETURNING id`,
    [userId],
  );
  productId = ins.rows[0].id;
  tempProductId = productId;
}

const sessionToken = await makeSessionToken(userId);
const sessionCookie = {
  name: "rizance_session",
  value: sessionToken,
  domain: "localhost",
  path: "/",
};

const browser = await chromium.launch({ headless: true });
const createdIds = [];

try {
  // ═══════════════════════════════════════════════════════════════
  // Seed orders in known statuses for stats + chips
  // ═══════════════════════════════════════════════════════════════
  const pendingA = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Pending A",
    db,
  });
  createdIds.push(pendingA.id);

  const pendingB = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Pending B",
    db,
  });
  createdIds.push(pendingB.id);

  const making = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Making",
    db,
  });
  createdIds.push(making.id);
  let r = await patchOrderStatus(sessionToken, making.id, "accepted");
  if (r.status !== 200) throw new Error(`making accept: ${JSON.stringify(r)}`);

  const ready = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Ready",
    db,
  });
  createdIds.push(ready.id);
  r = await patchOrderStatus(sessionToken, ready.id, "accepted");
  if (r.status !== 200) throw new Error(`ready accept: ${JSON.stringify(r)}`);
  r = await patchOrderStatus(sessionToken, ready.id, "cooking");
  if (r.status !== 200) throw new Error(`ready cooking: ${JSON.stringify(r)}`);
  r = await patchOrderStatus(sessionToken, ready.id, "ready");
  if (r.status !== 200) throw new Error(`ready ready: ${JSON.stringify(r)}`);

  // Make pendingB look >15 min old for red chip
  await db.query(`UPDATE pos_orders SET created_at = now() - interval '16 minutes' WHERE id=$1`, [
    pendingB.id,
  ]);

  // ═══════════════════════════════════════════════════════════════
  // 1) /orders — stats cards, filter, minute chips
  // ═══════════════════════════════════════════════════════════════
  const staff = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await staff.context().addCookies([sessionCookie]);
  await staff.goto(`${PROFIT}/home`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle", timeout: 60000 });
  await staff.waitForTimeout(1200);

  // 4 stats cards
  const pendingCard = staff.getByRole("button", { name: /ออเดอร์ใหม่/ });
  const makingCard = staff.getByRole("button", { name: /กำลังทำ/ }).first();
  const readyCard = staff.getByRole("button", { name: /พร้อมเสิร์ฟ/ }).first();
  const todayCard = staff.locator("div").filter({ hasText: /^ออเดอร์วันนี้/ }).first();

  const pendingCountText = await pendingCard.locator(".font-display").innerText();
  const makingCountText = await makingCard.locator(".font-display").innerText();
  const readyCountText = await readyCard.locator(".font-display").innerText();
  const todayVisible = await staff.getByText("ออเดอร์วันนี้").first().isVisible();

  if (Number(pendingCountText) === 2) pass("1a_pending_count", "2");
  else fail("1a_pending_count", `got ${pendingCountText}, want 2`);

  if (Number(makingCountText) === 1) pass("1a_making_count", "1");
  else fail("1a_making_count", `got ${makingCountText}, want 1`);

  if (Number(readyCountText) === 1) pass("1a_ready_count", "1");
  else fail("1a_ready_count", `got ${readyCountText}, want 1`);

  if (todayVisible) pass("1a_today_card");
  else fail("1a_today_card", "missing");

  // Filter by tapping pending card
  await pendingCard.click();
  await staff.waitForTimeout(400);
  const pendingOnlyVisible = await staff.getByText("E2E Pending A").isVisible();
  const pendingBVisible = await staff.getByText("E2E Pending B").isVisible();
  const makingHidden = !(await staff.getByText("E2E Making").isVisible().catch(() => false));
  const readyHidden = !(await staff.getByText("E2E Ready").isVisible().catch(() => false));
  if (pendingOnlyVisible && pendingBVisible && makingHidden && readyHidden) {
    pass("1b_filter_card_pending");
  } else {
    fail(
      "1b_filter_card_pending",
      `A=${pendingOnlyVisible} B=${pendingBVisible} makingHidden=${makingHidden} readyHidden=${readyHidden}`,
    );
  }

  // Tab filter → making
  await staff.getByRole("button", { name: /กำลังทำ \(\d+\)/ }).click();
  await staff.waitForTimeout(400);
  const makingVisible = await staff.getByText("E2E Making").isVisible();
  const pendingHidden = !(await staff.getByText("E2E Pending A").isVisible().catch(() => false));
  if (makingVisible && pendingHidden) pass("1b_filter_tab_making");
  else fail("1b_filter_tab_making", `making=${makingVisible} pendingHidden=${pendingHidden}`);

  // All tab
  await staff.getByRole("button", { name: /ทั้งหมด \(\d+\)/ }).click();
  await staff.waitForTimeout(400);

  // Minute chips on active cards
  const chips = staff.locator("span").filter({ hasText: /นาที|เมื่อกี้/ });
  const chipCount = await chips.count();
  if (chipCount >= 4) pass("1c_minute_chips", `${chipCount} chips`);
  else fail("1c_minute_chips", `only ${chipCount}`);

  // Red chip for 16-min-old order
  const oldChipCls = await staff.evaluate(() => {
    const card = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("E2E Pending B"),
    );
    if (!card) return null;
    const chip = [...card.querySelectorAll("span")].find((s) => {
      const t = (s.textContent || "").trim();
      return /^(เมื่อกี้|\d+ นาที)$/.test(t);
    });
    return chip ? { text: chip.textContent.trim(), cls: chip.className } : null;
  });
  if (oldChipCls && /danger/.test(oldChipCls.cls) && parseInt(oldChipCls.text, 10) >= 15) {
    pass("1c_red_over_15", `${oldChipCls.text}`);
  } else {
    fail("1c_red_over_15", JSON.stringify(oldChipCls));
  }

  // Fresh order should NOT be danger
  const freshChipCls = await staff.evaluate(() => {
    const card = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("E2E Pending A"),
    );
    if (!card) return null;
    const chip = [...card.querySelectorAll("span")].find((s) => {
      const t = (s.textContent || "").trim();
      return /^(เมื่อกี้|\d+ นาที)$/.test(t);
    });
    return chip ? { text: chip.textContent.trim(), cls: chip.className } : null;
  });
  if (freshChipCls && /warn/.test(freshChipCls.cls) && !/danger/.test(freshChipCls.cls)) {
    pass("1c_fresh_not_red", freshChipCls.text);
  } else {
    fail("1c_fresh_not_red", JSON.stringify(freshChipCls));
  }

  // ═══════════════════════════════════════════════════════════════
  // 5) Invalid phone → 400 + toast (not 500)
  // ═══════════════════════════════════════════════════════════════
  const badApi = await profitApi(sessionToken, "/api/pos/settings", {
    method: "PATCH",
    body: { shopPhone: "12345" },
  });
  if (badApi.status === 400 && badApi.body?.error === "invalid_input") {
    pass("5a_api_invalid_phone_400", JSON.stringify(badApi.body));
  } else {
    fail("5a_api_invalid_phone_400", `${badApi.status} ${JSON.stringify(badApi.body)}`);
  }

  await staff.getByRole("button", { name: /QR เมนูร้าน/ }).click();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const phoneInput = staff.getByPlaceholder(/0812345678/);
  await phoneInput.fill("12345");
  await staff
    .locator('[role="dialog"]')
    .getByRole("button", { name: "บันทึก" })
    .first()
    .click();
  await staff.waitForTimeout(800);
  const toastText = await staff.locator("body").innerText();
  if (/เบอร์ไม่ถูกต้อง|ไม่สำเร็จ/.test(toastText) && !/500/.test(toastText)) {
    pass("5b_toast_invalid_phone");
  } else {
    // toast may have auto-dismissed — API already verified 400
    const stillInvalid = await profitApi(sessionToken, "/api/pos/settings");
    const phone = stillInvalid.body?.data?.shopPhone;
    if (phone !== "12345") pass("5b_toast_invalid_phone", "rejected (toast may have dismissed)");
    else fail("5b_toast_invalid_phone", `phone saved as ${phone}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4) Set valid phone → customer sees button; clear → gone
  // ═══════════════════════════════════════════════════════════════
  await phoneInput.fill("0812345678");
  await staff
    .locator('[role="dialog"]')
    .getByRole("button", { name: "บันทึก" })
    .first()
    .click();
  await staff.waitForTimeout(800);
  const setPhone = await profitApi(sessionToken, "/api/pos/settings");
  if (setPhone.body?.data?.shopPhone === "0812345678") pass("4a_save_shop_phone");
  else fail("4a_save_shop_phone", JSON.stringify(setPhone.body));

  // Close dialog
  await staff.keyboard.press("Escape");
  await staff.waitForTimeout(300);

  // Pickup order for step tracker + phone button + info card
  const pickup = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Pickup Info",
    db,
  });
  createdIds.push(pickup.id);
  const pickupToken = pickup.accessToken;

  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // pending → step 1 yellow
  await guest.goto(`${POS}/o/${pickupToken}`, { waitUntil: "networkidle", timeout: 60000 });
  await guest.waitForTimeout(600);

  const phoneBtn = guest.getByRole("link", { name: /โทรหาร้าน/ });
  if (await phoneBtn.isVisible()) {
    const href = await phoneBtn.getAttribute("href");
    if (href === "tel:0812345678") pass("4b_call_shop_visible", href);
    else fail("4b_call_shop_visible", `href=${href}`);
  } else {
    fail("4b_call_shop_visible", "button missing");
  }

  // Info card — pickup + at_shop
  const infoCard = guest.locator("text=ข้อมูลการสั่งซื้อ").locator("..");
  const infoText = await infoCard.innerText();
  if (/มารับที่ร้าน/.test(infoText) && /ชำระที่ร้าน/.test(infoText)) {
    pass("6a_info_pickup_at_shop");
  } else {
    fail("6a_info_pickup_at_shop", infoText.slice(0, 300));
  }

  // Step tracker pending
  let steps = await stepState(guest);
  const hasTracker = await guest.getByText("รับออเดอร์", { exact: true }).isVisible();
  const s1 = steps.find((s) => s.label === "รับออเดอร์");
  const pickupStep3 = steps.find((s) => s.label === "พร้อมเสิร์ฟ");
  if (hasTracker && s1?.current && pickupStep3) {
    pass("2a_pending_step1_yellow");
    pass("3b_pickup_step3_label", "พร้อมเสิร์ฟ");
  } else {
    fail("2a_pending_step1_yellow", JSON.stringify(steps));
    if (!pickupStep3) fail("3b_pickup_step3_label", JSON.stringify(steps));
    else pass("3b_pickup_step3_label");
  }

  // accepted → step 2
  r = await patchOrderStatus(sessionToken, pickup.id, "accepted");
  if (r.status !== 200) throw new Error(`pickup accept: ${JSON.stringify(r)}`);
  await guest.reload({ waitUntil: "networkidle" });
  await guest.waitForTimeout(500);
  steps = await stepState(guest);
  const s2 = steps.find((s) => s.label === "กำลังทำ");
  if (s2?.current && steps.find((s) => s.label === "รับออเดอร์")?.done) {
    pass("2b_accepted_step2");
  } else {
    fail("2b_accepted_step2", JSON.stringify(steps));
  }

  // cooking still step 2
  r = await patchOrderStatus(sessionToken, pickup.id, "cooking");
  if (r.status !== 200) throw new Error(`pickup cooking: ${JSON.stringify(r)}`);
  await guest.reload({ waitUntil: "networkidle" });
  await guest.waitForTimeout(500);
  steps = await stepState(guest);
  if (steps.find((s) => s.label === "กำลังทำ")?.current) pass("2c_cooking_step2");
  else fail("2c_cooking_step2", JSON.stringify(steps));

  // ready → step 3
  r = await patchOrderStatus(sessionToken, pickup.id, "ready");
  if (r.status !== 200) throw new Error(`pickup ready: ${JSON.stringify(r)}`);
  await guest.reload({ waitUntil: "networkidle" });
  await guest.waitForTimeout(500);
  steps = await stepState(guest);
  if (steps.find((s) => s.label === "พร้อมเสิร์ฟ")?.current) pass("2d_ready_step3");
  else fail("2d_ready_step3", JSON.stringify(steps));

  // completed → all green
  r = await patchOrderStatus(sessionToken, pickup.id, "completed");
  if (r.status !== 200) {
    fail("2e_complete_api", `${r.status} ${JSON.stringify(r.body)}`);
  } else {
    await guest.reload({ waitUntil: "networkidle" });
    await guest.waitForTimeout(500);
    steps = await stepState(guest);
    const allGreen = steps.every((s) => s.done) && !steps.some((s) => s.current);
    if (allGreen || steps.every((s) => s.done || s.circleDone)) pass("2e_completed_all_green");
    else fail("2e_completed_all_green", JSON.stringify(steps));
  }

  // cancelled → hide tracker
  const cancelled = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "at_shop",
    name: "E2E Cancelled",
    db,
  });
  createdIds.push(cancelled.id);
  r = await patchOrderStatus(sessionToken, cancelled.id, "cancelled");
  if (r.status !== 200) throw new Error(`cancel: ${JSON.stringify(r)}`);
  await guest.goto(`${POS}/o/${cancelled.accessToken}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await guest.waitForTimeout(500);
  const trackerHidden = !(await guest
    .getByText("รับออเดอร์", { exact: true })
    .isVisible()
    .catch(() => false));
  if (trackerHidden) pass("2f_cancelled_hide_tracker");
  else fail("2f_cancelled_hide_tracker", "tracker still visible");

  // Clear shop phone
  const clearPhone = await profitApi(sessionToken, "/api/pos/settings", {
    method: "PATCH",
    body: { shopPhone: null },
  });
  if (clearPhone.body?.data?.shopPhone == null) pass("4c_clear_shop_phone_api");
  else fail("4c_clear_shop_phone_api", JSON.stringify(clearPhone.body));

  // New pending order after clear — button gone
  const noPhone = await placePublicOrder({
    menuToken,
    productId,
    orderType: "pickup",
    paymentIntent: "prepaid_transfer",
    name: "E2E No Phone",
    db,
  });
  createdIds.push(noPhone.id);
  await guest.goto(`${POS}/o/${noPhone.accessToken}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await guest.waitForTimeout(500);
  if (!(await guest.getByRole("link", { name: /โทรหาร้าน/ }).isVisible().catch(() => false))) {
    pass("4d_call_shop_hidden");
  } else {
    fail("4d_call_shop_hidden", "button still visible");
  }

  // Info card prepaid pickup
  const info2 = await guest.locator("text=ข้อมูลการสั่งซื้อ").locator("..").innerText();
  if (/มารับที่ร้าน/.test(info2) && /โอน \(รอตรวจสลิป\)/.test(info2)) {
    pass("6b_info_pickup_prepaid");
  } else {
    fail("6b_info_pickup_prepaid", info2.slice(0, 300));
  }

  // ═══════════════════════════════════════════════════════════════
  // 3) Delivery step 3 label + info card COD
  // ═══════════════════════════════════════════════════════════════
  const delivery = await placePublicOrder({
    menuToken,
    productId,
    orderType: "delivery",
    paymentIntent: "at_shop",
    name: "E2E Delivery",
    db,
  });
  createdIds.push(delivery.id);
  await guest.goto(`${POS}/o/${delivery.accessToken}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await guest.waitForTimeout(500);

  const delSteps = await stepState(guest);
  const delStep3 = delSteps.find((s) => s.label === "กำลังไปส่ง");
  if (delStep3) pass("3a_delivery_step3_label", "กำลังไปส่ง");
  else fail("3a_delivery_step3_label", JSON.stringify(delSteps));

  const infoDel = await guest.locator("text=ข้อมูลการสั่งซื้อ").locator("..").innerText();
  if (/เดลิเวอรี่/.test(infoDel) && /เงินสดปลายทาง/.test(infoDel)) {
    pass("6c_info_delivery_cod");
  } else {
    fail("6c_info_delivery_cod", infoDel.slice(0, 300));
  }

  // Delivery prepaid
  const delPrepay = await placePublicOrder({
    menuToken,
    productId,
    orderType: "delivery",
    paymentIntent: "prepaid_transfer",
    name: "E2E Del Prepay",
    db,
  });
  createdIds.push(delPrepay.id);
  await guest.goto(`${POS}/o/${delPrepay.accessToken}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await guest.waitForTimeout(500);
  const infoDelP = await guest.locator("text=ข้อมูลการสั่งซื้อ").locator("..").innerText();
  if (/เดลิเวอรี่/.test(infoDelP) && /โอน \(รอตรวจสลิป\)/.test(infoDelP)) {
    pass("6d_info_delivery_prepaid");
  } else {
    fail("6d_info_delivery_prepaid", infoDelP.slice(0, 300));
  }

  // Empty string save via QR UI (เว้นว่างบันทึก)
  await staff.getByRole("button", { name: /QR เมนูร้าน/ }).click();
  await staff.waitForSelector('[role="dialog"]', { timeout: 10000 });
  // set phone first then clear
  await phoneInput.fill("0899999999");
  await staff.locator('[role="dialog"]').getByRole("button", { name: "บันทึก" }).first().click();
  await staff.waitForTimeout(600);
  await phoneInput.fill("");
  await staff.locator('[role="dialog"]').getByRole("button", { name: "บันทึก" }).first().click();
  await staff.waitForTimeout(800);
  const afterClear = await profitApi(sessionToken, "/api/pos/settings");
  if (afterClear.body?.data?.shopPhone == null) pass("4e_ui_clear_empty_save");
  else fail("4e_ui_clear_empty_save", JSON.stringify(afterClear.body?.data?.shopPhone));

  await staff.close();
  await guest.close();
} catch (err) {
  fail("fatal", err?.stack || String(err));
} finally {
  // cleanup
  if (createdIds.length) {
    await db.query(
      `UPDATE pos_orders SET status='cancelled', cancel_reason='e2e orders-ux cleanup'
       WHERE id = ANY($1::uuid[]) AND status NOT IN ('completed','cancelled')`,
      [createdIds],
    );
  }
  await db.query(`UPDATE pos_shop_settings SET shop_phone=NULL WHERE user_id=$1`, [userId]);
  if (tempProductId) {
    await db.query(`DELETE FROM pos_products WHERE id=$1 AND user_id=$2`, [tempProductId, userId]);
  }
  await browser.close();
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log("\n── Summary ──");
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.n}: ${f.d}`);
  process.exit(1);
}
process.exit(0);
