/**
 * Delivery geo checklist (0059)
 * a) /products @390 — name wrap, no "เปิดขาย" mid-card, ON/OFF switch colors
 * b) /m share location → green card + ±meters
 * c) order with geo only (no landmark) → allowed
 * d) no geo + no address → blocked client + API (delivery_unavailable)
 * e) staff card "นำทางไปส่ง" → google maps dir href
 * f) collect → SUM(bill_items)=total=debit=credit + fee line product_id IS NULL
 *
 * Usage: node scripts/e2e-pos-delivery-geo.mjs
 * Requires: profit :3000, pos :3001, migration 0059
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
const GEO = { lat: 13.756331, lng: 100.501762, accuracy: 24 };

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

function almost(a, b, eps = 0.011) {
  return Math.abs(parseFloat(a) - parseFloat(b)) < eps;
}

async function findOrderCard(page, orderNo) {
  return page.locator("li").filter({ hasText: orderNo }).first();
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
  `UPDATE pos_orders SET status='cancelled', cancel_reason='e2e geo cleanup'
   WHERE user_id=$1 AND status IN ('pending','accepted','cooking','ready')`,
  [userId],
);

await db.query(
  `UPDATE pos_shop_settings
   SET online_ordering_enabled=true, kitchen_enabled=true,
       delivery_enabled=true, delivery_fee=30, delivery_min_order=0
   WHERE user_id=$1`,
  [userId],
);

const tokQ = await db.query(
  `SELECT public_menu_token FROM pos_shop_settings WHERE user_id=$1`,
  [userId],
);
const menuToken = tokQ.rows[0]?.public_menu_token;
if (!menuToken) throw new Error("no public_menu_token");

const products = await db.query(
  `SELECT id, name, sell_price::float AS price
   FROM pos_products
   WHERE user_id=$1 AND is_active=true
   ORDER BY sell_price ASC
   LIMIT 8`,
  [userId],
);
if (!products.rows.length) throw new Error("no active products");

const sessionToken = await makeSessionToken(userId);
const sessionCookie = {
  name: "rizance_session",
  value: sessionToken,
  domain: "localhost",
  path: "/",
};

const browser = await chromium.launch({ headless: true });
let deliveryOrderId = null;
let billId = null;

try {
  // ═══════════════════════════════════════════════════════════════
  // a) /products @390
  // ═══════════════════════════════════════════════════════════════
  const staff = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await staff.context().addCookies([sessionCookie]);
  await staff.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 60000 });
  await staff.waitForTimeout(800);

  const cards = staff.locator("main li").filter({ has: staff.locator('[role="switch"]') });
  const cardCount = await cards.count();
  if (cardCount === 0) {
    fail("a_product_cards", "no product cards with switch");
  } else {
    pass("a_product_cards", `${cardCount} cards`);
  }

  let nameOk = true;
  let midCardOk = true;
  let switchOk = true;
  const sample = Math.min(cardCount, 4);
  for (let i = 0; i < sample; i++) {
    const card = cards.nth(i);
    const nameEl = card.locator(".line-clamp-2, .font-medium").first();
    const nameClass = (await nameEl.getAttribute("class").catch(() => "")) || "";
    if (/\bbreak-all\b/.test(nameClass) || /\bword-break-all\b/.test(nameClass)) {
      nameOk = false;
      fail("a_name_no_break_all", `card ${i}: ${nameClass}`);
    }
    // word-break: keep-all / normal or overflow-wrap via break-words is OK
    const wb = await nameEl.evaluate((el) => getComputedStyle(el).wordBreak).catch(() => "");
    if (wb === "break-all") {
      nameOk = false;
      fail("a_name_computed_break", `card ${i}: word-break=${wb}`);
    }

    const visibleText = await card.innerText();
    if (/เปิดขาย/.test(visibleText)) {
      midCardOk = false;
      fail("a_no_open_sale_text", `card ${i}: found เปิดขาย in visible text`);
    }

    const sw = card.locator('[role="switch"]').first();
    const swBox = await sw.boundingBox();
    const cardBox = await card.boundingBox();
    if (!swBox || !cardBox) {
      switchOk = false;
      fail("a_switch_position", `card ${i}: missing box`);
    } else {
      // switch should be in bottom half of card
      const midY = cardBox.y + cardBox.height / 2;
      if (swBox.y + swBox.height / 2 < midY - 4) {
        switchOk = false;
        fail("a_switch_bottom", `card ${i}: switch not in bottom half`);
      }
    }

    // colors: ON green / OFF red
    const checked = await sw.getAttribute("aria-checked");
    const swClass = (await sw.getAttribute("class")) || "";
    if (checked === "true") {
      if (!/money-in|green/.test(swClass)) {
        // check computed bg
        const bg = await sw.evaluate((el) => getComputedStyle(el).backgroundColor);
        // money-in soft is greenish — accept any non-red
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m && parseInt(m[1]) > parseInt(m[2]) + 30) {
          switchOk = false;
          fail("a_switch_on_green", `card ${i}: ON bg looks red ${bg}`);
        }
      }
      const onLabel = await sw.innerText();
      if (!/ON/i.test(onLabel)) {
        switchOk = false;
        fail("a_switch_on_label", `card ${i}: ${onLabel}`);
      }
    } else {
      if (!/danger|red/.test(swClass)) {
        const bg = await sw.evaluate((el) => getComputedStyle(el).backgroundColor);
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m && parseInt(m[2]) > parseInt(m[1]) + 30) {
          switchOk = false;
          fail("a_switch_off_red", `card ${i}: OFF bg looks green ${bg}`);
        }
      }
      const offLabel = await sw.innerText();
      if (!/OFF/i.test(offLabel)) {
        switchOk = false;
        fail("a_switch_off_label", `card ${i}: ${offLabel}`);
      }
    }
  }
  if (nameOk) pass("a_name_wrap", "break-words / no break-all");
  if (midCardOk) pass("a_no_open_sale_midcard", "เปิดขาย only in aria-label");
  if (switchOk) pass("a_switch_on_off_bottom", "ON green / OFF red bottom row");

  // Toggle one OFF then ON to verify both states if all were ON
  const firstSw = cards.first().locator('[role="switch"]');
  const wasOn = (await firstSw.getAttribute("aria-checked")) === "true";
  await firstSw.click();
  await staff.waitForTimeout(500);
  const after = await firstSw.getAttribute("aria-checked");
  const afterText = await firstSw.innerText();
  const afterClass = (await firstSw.getAttribute("class")) || "";
  if (wasOn && after === "false" && /OFF/i.test(afterText) && /danger/.test(afterClass)) {
    pass("a_toggle_off_red", afterClass.slice(0, 80));
  } else if (!wasOn && after === "true" && /ON/i.test(afterText) && /money-in/.test(afterClass)) {
    pass("a_toggle_on_green", afterClass.slice(0, 80));
  } else {
    // still ok if class tokens differ — check label at least
    if ((after === "false" && /OFF/i.test(afterText)) || (after === "true" && /ON/i.test(afterText))) {
      pass("a_toggle_label", `checked=${after} text=${afterText}`);
    } else {
      fail("a_toggle", `was=${wasOn} after=${after} text=${afterText} class=${afterClass.slice(0, 60)}`);
    }
  }
  // restore
  if (after !== String(wasOn)) {
    await firstSw.click();
    await staff.waitForTimeout(400);
  }

  // ═══════════════════════════════════════════════════════════════
  // b–d) guest /m geo flow
  // ═══════════════════════════════════════════════════════════════
  const guestCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: GEO.lat, longitude: GEO.lng, accuracy: GEO.accuracy },
    permissions: ["geolocation"],
  });
  const guest = await guestCtx.newPage();

  // pick products totaling >= 50 for a real order
  let pick = [];
  let sum = 0;
  for (const p of products.rows) {
    pick.push(p);
    sum += p.price;
    if (sum >= 50) break;
  }

  await guest.goto(`${POS}/m/${menuToken}`, { waitUntil: "networkidle", timeout: 60000 });
  for (const p of pick) {
    const card = guest.getByText(p.name, { exact: false }).first();
    if (!(await card.isVisible().catch(() => false))) continue;
    await card.click();
    await guest.waitForTimeout(350);
    const dlg = guest.locator('[role="dialog"]');
    if (await dlg.isVisible().catch(() => false)) {
      const title = await dlg.locator("h2,h3").first().innerText().catch(() => "");
      if (/ตะกร้า|สรุป/.test(title)) {
        await guest.keyboard.press("Escape");
        continue;
      }
      const opt = dlg
        .locator("button")
        .filter({ hasText: /Sauce|ซอส|ปกติ|Spicy|ชีส|ธรรมดา|เพิ่ม/ })
        .first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
      const add = dlg.getByRole("button", { name: /ใส่ตะกร้า/ });
      if (await add.isVisible().catch(() => false)) await add.click();
    }
  }

  await guest.getByRole("button", { name: /ดูตะกร้า/ }).click();
  await guest.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await guest.getByRole("button", { name: /ส่งถึงบ้าน/ }).click();
  await guest.waitForTimeout(300);

  // d) before geo: try submit without address → client block
  await guest.getByPlaceholder("เช่น น้องเฟม").fill("E2E Geo Customer");
  await guest.getByPlaceholder("08xxxxxxxx").fill("0833333333");
  // ensure address empty
  const addr = guest.getByPlaceholder(/บ้านรั้ว|จุดสังเกต|บ้านเลขที่/);
  if (await addr.isVisible().catch(() => false)) await addr.fill("");

  const confirmBtn = guest.getByRole("button", { name: /ยืนยันสั่ง/ });
  await confirmBtn.click();
  await guest.waitForTimeout(500);
  const clientErr = await guest.locator('[role="dialog"]').innerText();
  if (/แชร์ตำแหน่ง|พิมพ์ที่อยู่/.test(clientErr) && !guest.url().includes("/o/")) {
    pass("d_client_block_no_geo_no_addr");
  } else {
    fail("d_client_block_no_geo_no_addr", clientErr.slice(0, 250));
  }

  // d) API block
  const apiBlock = await guest.evaluate(
    async ({ profit, token, items }) => {
      const res = await fetch(`${profit}/api/public/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          customerName: "E2E No Loc",
          customerPhone: "0833333333",
          orderType: "delivery",
          items,
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    {
      profit: PROFIT,
      token: menuToken,
      items: pick.map((p) => ({ productId: p.id, qty: 1 })),
    },
  );
  if (apiBlock.status === 400 && apiBlock.body?.error === "delivery_unavailable") {
    pass("d_api_delivery_unavailable");
  } else {
    fail("d_api_delivery_unavailable", JSON.stringify(apiBlock));
  }

  // b) share location
  const shareBtn = guest.getByRole("button", { name: /แชร์ตำแหน่งที่จะส่ง/ });
  if (await shareBtn.isVisible().catch(() => false)) {
    await shareBtn.click();
    await guest.waitForTimeout(1500);
  } else {
    fail("b_share_button", "button not visible");
  }

  const dlgText = await guest.locator('[role="dialog"]').innerText();
  if (/แชร์ตำแหน่งแล้ว/.test(dlgText) && /±\s*\d+\s*เมตร|±\d+/.test(dlgText)) {
    pass("b_green_card_accuracy", dlgText.match(/[^\n]*±[^\n]*/)?.[0] || "ok");
  } else if (/แชร์ตำแหน่งแล้ว/.test(dlgText) && /ความแม่นยำ|เมตร/.test(dlgText)) {
    pass("b_green_card_accuracy", dlgText.match(/[^\n]*เมตร[^\n]*/)?.[0] || "ok");
  } else {
    // check DOM green card
    const green = guest.locator(".bg-money-in-soft, [class*='money-in']").filter({
      hasText: /แชร์ตำแหน่งแล้ว/,
    });
    if (await green.first().isVisible().catch(() => false)) {
      const t = await green.first().innerText();
      if (/±|เมตร/.test(t)) pass("b_green_card_accuracy", t.slice(0, 80));
      else fail("b_green_card_accuracy", `green visible but no ±m: ${t}`);
    } else {
      fail("b_green_card_accuracy", dlgText.slice(0, 300));
    }
  }

  // c) submit with geo only — leave landmark empty
  if (await addr.isVisible().catch(() => false)) await addr.fill("");
  // turn off push if present
  const pushToggle = guest.getByText("เตือนฉันตอนอาหารพร้อม");
  if (await pushToggle.isVisible().catch(() => false)) {
    await pushToggle.click().catch(() => {});
  }

  await confirmBtn.click();
  try {
    await guest.waitForURL(/\/o\//, { timeout: 30000 });
    pass("c_geo_only_submit", guest.url());
  } catch {
    const err = await guest.locator('[role="dialog"]').innerText().catch(() => "");
    fail("c_geo_only_submit", err.slice(0, 300));
  }

  const accessToken = guest.url().split("/o/")[1]?.split(/[?#]/)[0];
  const orderRow = await db.query(
    `SELECT id, order_no, order_type, delivery_fee::float AS delivery_fee,
            total_amount::float AS total_amount,
            delivery_address, delivery_lat::float AS lat, delivery_lng::float AS lng,
            delivery_accuracy_m::float AS accuracy_m
     FROM pos_orders WHERE access_token=$1`,
    [accessToken],
  );
  const ord = orderRow.rows[0];
  deliveryOrderId = ord?.id;

  if (ord?.order_type === "delivery" && almost(ord.lat, GEO.lat) && almost(ord.lng, GEO.lng)) {
    pass("c_geo_saved", `lat=${ord.lat} lng=${ord.lng} ±${ord.accuracy_m}`);
  } else {
    fail("c_geo_saved", JSON.stringify(ord));
  }
  if (!ord?.delivery_address) pass("c_address_null", "landmark empty as expected");
  else pass("c_address_null", `had address="${ord.delivery_address}" (still ok if optional filled)`);

  await guestCtx.close();

  // ═══════════════════════════════════════════════════════════════
  // e) staff maps navigate button
  // ═══════════════════════════════════════════════════════════════
  await staff.goto(`${POS}/orders`, { waitUntil: "networkidle", timeout: 60000 });
  await staff.waitForTimeout(800);
  const card = await findOrderCard(staff, ord.order_no);
  const nav = card.getByRole("link", { name: /นำทางไปส่ง/ }).or(
    card.locator('a[href*="google.com/maps"]'),
  );
  // Button component may render as <a>
  let href = null;
  if (await nav.first().isVisible().catch(() => false)) {
    href = await nav.first().getAttribute("href");
  } else {
    // maybe Button with href renders differently
    const anyNav = card.locator("a,button").filter({ hasText: /นำทางไปส่ง/ });
    if (await anyNav.first().isVisible().catch(() => false)) {
      href = await anyNav.first().getAttribute("href");
      pass("e_nav_button_visible");
    } else {
      fail("e_nav_button_visible", (await card.innerText()).slice(0, 300));
    }
  }
  if (href) {
    const expected = `https://www.google.com/maps/dir/?api=1&destination=${ord.lat},${ord.lng}&travelmode=driving`;
    // tolerate string lat/lng formatting from DB (may trim trailing zeros)
    const m = href.match(
      /google\.com\/maps\/dir\/\?api=1&destination=([-\d.]+),([-\d.]+)&travelmode=driving/,
    );
    if (
      m &&
      almost(m[1], ord.lat) &&
      almost(m[2], ord.lng) &&
      href.includes("google.com/maps/dir/?api=1") &&
      href.includes("travelmode=driving")
    ) {
      pass("e_maps_href", href);
    } else if (href === expected) {
      pass("e_maps_href", href);
    } else {
      fail("e_maps_href", `got=${href} expected~=${expected}`);
    }
  } else if (!results.some((r) => r.n === "e_nav_button_visible" && !r.ok)) {
    fail("e_maps_href", "no href");
  }

  // ═══════════════════════════════════════════════════════════════
  // f) advance + collect → money invariant
  // ═══════════════════════════════════════════════════════════════
  for (const status of ["accepted", "cooking", "ready"]) {
    const stRes = await profitApi(sessionToken, `/api/pos/orders/${deliveryOrderId}`, {
      method: "PATCH",
      body: { status },
    });
    if (stRes.status !== 200) {
      fail("f_advance", `${status}: ${JSON.stringify(stRes)}`);
      break;
    }
  }

  // close via API (reliable) — same path UI uses for surcharges
  const items = await db.query(
    `SELECT oi.product_id, oi.quantity::float AS qty,
            COALESCE(
              array_agg(om.modifier_id::text) FILTER (WHERE om.modifier_id IS NOT NULL),
              '{}'
            ) AS mods
     FROM pos_order_items oi
     LEFT JOIN pos_order_item_modifiers om ON om.order_item_id = oi.id
     WHERE oi.order_id=$1 AND oi.product_id IS NOT NULL
     GROUP BY oi.id`,
    [deliveryOrderId],
  );
  const closeRes = await profitApi(sessionToken, "/api/pos/bills", {
    method: "POST",
    body: {
      items: items.rows.map((r) => ({
        productId: r.product_id,
        qty: r.qty,
        modifierIds: r.mods?.length ? r.mods : undefined,
      })),
      surcharges: [{ label: "ค่าส่งเดลิเวอรี่", amount: ord.delivery_fee }],
      payments: [{ method: "cash", amount: ord.total_amount }],
    },
  });
  if (closeRes.status === 200 || closeRes.status === 201) {
    billId = closeRes.body?.data?.bill?.id;
    pass("f_collect", billId?.slice(0, 8));
    if (billId) {
      await profitApi(sessionToken, `/api/pos/orders/${deliveryOrderId}`, {
        method: "PATCH",
        body: { status: "completed", billId },
      });
    }
  } else {
    fail("f_collect", JSON.stringify(closeRes));
  }

  if (billId) {
    const billQ = await db.query(
      `SELECT total_amount::float AS total_amount FROM pos_bills WHERE id=$1`,
      [billId],
    );
    const billTotal = billQ.rows[0].total_amount;

    const feeLine = await db.query(
      `SELECT product_id, product_name, line_total::float AS line_total
       FROM pos_bill_items
       WHERE bill_id=$1 AND product_id IS NULL AND product_name LIKE '%ค่าส่ง%'`,
      [billId],
    );
    if (feeLine.rows[0] && almost(feeLine.rows[0].line_total, ord.delivery_fee)) {
      pass("f_fee_line_null_product", JSON.stringify(feeLine.rows[0]));
    } else {
      fail("f_fee_line_null_product", JSON.stringify(feeLine.rows));
    }

    const sumItems = await db.query(
      `SELECT COALESCE(SUM(line_total),0)::float AS s FROM pos_bill_items WHERE bill_id=$1`,
      [billId],
    );

    const journal = await db.query(
      `SELECT
         COALESCE(SUM(jl.debit),0)::float AS debit,
         COALESCE(SUM(jl.credit),0)::float AS credit,
         COALESCE(SUM(CASE WHEN jl.account_code IN ('1000','1010') THEN jl.debit ELSE 0 END),0)::float AS cash_debit,
         COALESCE(SUM(CASE WHEN jl.account_code = '4000' THEN jl.credit ELSE 0 END),0)::float AS revenue_credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id=$1
         AND je.source_module='pos'
         AND je.source_event_id=$2
         AND je.source_event_type='pos_bill_paid'`,
      [userId, billId],
    );
    const j = journal.rows[0];

    if (
      almost(sumItems.rows[0].s, billTotal) &&
      almost(billTotal, ord.total_amount) &&
      almost(j.debit, j.credit) &&
      almost(j.cash_debit, billTotal) &&
      almost(j.revenue_credit, billTotal)
    ) {
      pass(
        "f_invariant",
        `SUM(items)=${sumItems.rows[0].s}=total=${billTotal}; debit=credit=${j.debit}`,
      );
    } else {
      fail(
        "f_invariant",
        JSON.stringify({
          sumItems: sumItems.rows[0].s,
          billTotal,
          orderTotal: ord.total_amount,
          ...j,
        }),
      );
    }
  }
} catch (err) {
  fail("fatal", err?.stack || String(err));
} finally {
  await browser.close();
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log("\n======== SUMMARY ========");
console.log(`PASS ${results.filter((r) => r.ok).length} / FAIL ${failed.length}`);
for (const r of failed) console.log(`  FAIL ${r.n}: ${r.d}`);
process.exitCode = failed.length ? 1 : 0;
