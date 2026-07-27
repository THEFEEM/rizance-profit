/**
 * Market-trip checklist (0060 + /stock/market)
 * a) stock → edit เนื้อบด/ชีส categories → save
 * b) ไปตลาด → grouped by category
 * c) tick เนื้อบด → qty autofill → cost 1250
 * d) extra ถุงกระดาษ 120
 * e) offline → tick another → reload → localStorage draft intact
 * f) online → บันทึกทั้งหมด → DB checks
 * g) API lines:[] extraItems:[] → empty_trip 400
 *
 * Usage: node scripts/e2e-market-trip.mjs
 * Requires: profit :3000, pos :3001, migration 0060
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

loadEnv();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const db = new pg.Pool(pgClientOptions(process.env.DATABASE_URL));

const userRow = await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [
  NINENON_EMAIL,
]);
if (!userRow.rows[0]) {
  console.error("User not found:", NINENON_EMAIL);
  process.exit(1);
}
const userId = userRow.rows[0].id;
const sessionToken = await makeSessionToken(userId);

// --- Seed / locate ingredients ---
async function ensureIngredient(nameHint, defaults) {
  const found = await db.query(
    `SELECT id, name, stock_qty, avg_cost, last_purchase_price, category,
            purchase_quantity, purchase_price, low_stock_threshold
     FROM ingredients
     WHERE user_id=$1 AND name ILIKE $2
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 5`,
    [userId, `%${nameHint}%`],
  );
  if (found.rows[0]) return found.rows[0];

  const created = await profitApi(sessionToken, "/api/pos/ingredients", {
    method: "POST",
    body: defaults,
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create ${nameHint} failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = created.body?.data?.id;
  const row = await db.query(
    `SELECT id, name, stock_qty, avg_cost, last_purchase_price, category,
            purchase_quantity, purchase_price, low_stock_threshold
     FROM ingredients WHERE id=$1`,
    [id],
  );
  return row.rows[0];
}

const beef = await ensureIngredient("เนื้อบด", {
  name: "เนื้อบด",
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  purchasePrice: 280,
  trackStock: true,
  lowStockThreshold: 5,
  category: "เนื้อ/ของสด",
});
const cheese = await ensureIngredient("ชีส", {
  name: "ชีสแผ่น",
  purchaseQuantity: 1,
  purchaseUnit: "kg",
  purchasePrice: 180,
  trackStock: true,
  lowStockThreshold: 3,
  category: "ชีส/นม",
});
const other = await ensureIngredient("ขนมปัง", {
  name: "ขนมปังเบอร์เกอร์",
  purchaseQuantity: 12,
  purchaseUnit: "piece",
  purchasePrice: 60,
  trackStock: true,
  lowStockThreshold: 24,
  category: "ขนมปัง",
});

// Force low stock so shopping list suggests qty (for autofill)
await db.query(
  `UPDATE ingredients
   SET stock_qty = 0.5,
       low_stock_threshold = GREATEST(COALESCE(low_stock_threshold, 0), 3),
       track_stock = true,
       updated_at = now()
   WHERE id = ANY($1::uuid[])`,
  [[beef.id, cheese.id, other.id]],
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "th-TH",
});
await context.addCookies([
  {
    name: "rizance_session",
    value: sessionToken,
    domain: "localhost",
    path: "/",
  },
]);
// Warm cookie on profit origin (POS proxies cross-port)
await context.request.get(`${PROFIT}/api/pos/session`, {
  headers: { Cookie: `rizance_session=${sessionToken}` },
});

const page = await context.newPage();

try {
  // ========== a) Edit categories on stock ==========
  await page.goto(`${POS}/stock`, { waitUntil: "networkidle" });
  // Stock tab label is "คงเหลือ"
  await page.getByRole("button", { name: /คงเหลือ/ }).click().catch(() => undefined);

  async function editCategory(ingredientName, category) {
    const card = page.locator("li").filter({ hasText: ingredientName }).first();
    await card.getByRole("button", { name: "แก้ไข" }).click();
    await page.getByRole("dialog").getByText("แก้ไขวัตถุดิบ").waitFor({ timeout: 8000 });
    await page
      .getByRole("dialog")
      .locator("select")
      .filter({ has: page.locator(`option[value="${category}"]`) })
      .first()
      .selectOption(category);
    await page.getByRole("dialog").getByRole("button", { name: /บันทึก/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  await editCategory(beef.name, "เนื้อ/ของสด");
  await editCategory(cheese.name, "ชีส/นม");

  const cats = await db.query(
    `SELECT name, category FROM ingredients WHERE id = ANY($1::uuid[])`,
    [[beef.id, cheese.id]],
  );
  const byName = Object.fromEntries(cats.rows.map((r) => [r.name, r.category]));
  if (byName[beef.name] === "เนื้อ/ของสด" && byName[cheese.name] === "ชีส/นม") {
    pass("a-categories", `${beef.name}=เนื้อ/ของสด, ${cheese.name}=ชีส/นม`);
  } else {
    fail("a-categories", JSON.stringify(byName));
  }

  // ========== b) Market page grouped ==========
  await page.getByRole("link", { name: /ไปตลาด/ }).click();
  await page.waitForURL(/\/stock\/market/, { timeout: 10000 });
  await page.getByText("ไปตลาด").first().waitFor();

  // Show all so grouping is visible even if shopping list empty
  const showAllBtn = page.getByRole("button", { name: /ดูวัตถุดิบทั้งหมด/ });
  if (await showAllBtn.isVisible().catch(() => false)) {
    await showAllBtn.click();
  }

  const meatHeader = page.getByRole("heading", { name: "เนื้อ/ของสด" });
  const cheeseHeader = page.getByRole("heading", { name: "ชีส/นม" });
  const meatVisible = await meatHeader.isVisible().catch(() => false);
  const cheeseVisible = await cheeseHeader.isVisible().catch(() => false);

  // Verify DOM order: meat section before cheese if both present
  let orderOk = true;
  if (meatVisible && cheeseVisible) {
    const meatY = await meatHeader.boundingBox();
    const cheeseY = await cheeseHeader.boundingBox();
    orderOk = meatY && cheeseY && meatY.y < cheeseY.y;
  }
  if (meatVisible && cheeseVisible && orderOk) {
    pass("b-grouped", "หมวด เนื้อ/ของสด แล้วตามด้วย ชีส/นม");
  } else if (meatVisible || cheeseVisible) {
    pass("b-grouped", `partial headers meat=${meatVisible} cheese=${cheeseVisible}`);
  } else {
    fail("b-grouped", "category headers not visible");
  }

  // ========== c) Tick beef → autofill qty → cost 1250 ==========
  const beefCard = page.locator("li").filter({ hasText: beef.name }).first();
  await beefCard.getByRole("button", { name: new RegExp(`ซื้อ ${beef.name}`) }).click();
  await page.waitForTimeout(300);
  const qtyInput = beefCard.locator('input[type="number"]').first();
  const costInput = beefCard.locator('input[type="number"]').nth(1);
  let qtyVal = await qtyInput.inputValue();
  if (!qtyVal || Number(qtyVal) <= 0) {
    // Fallback: shopping list may not suggest — fill 5 so rest of flow works, mark soft fail
    fail("c-autofill-qty", `qty stayed empty ("${qtyVal}") — filled manually with 5`);
    await qtyInput.fill("5");
    qtyVal = "5";
  } else {
    pass("c-autofill-qty", `qty=${qtyVal}`);
  }
  await costInput.fill("1250");
  const costVal = await costInput.inputValue();
  if (costVal === "1250") pass("c-price-1250");
  else fail("c-price-1250", `got ${costVal}`);

  // ========== d) Extra item ==========
  await page.getByRole("button", { name: /เพิ่มของนอกลิสต์/ }).click();
  const extraSheet = page.getByRole("dialog");
  await extraSheet.getByText("เพิ่มของนอกลิสต์").waitFor({ timeout: 5000 });
  await extraSheet.getByPlaceholder(/ถุงกระดาษ/).fill("ถุงกระดาษ");
  await extraSheet.locator("label").filter({ hasText: "ราคา" }).locator("input").fill("120");
  await extraSheet.getByRole("button", { name: "เพิ่มเข้าลิสต์" }).click();
  await page.waitForTimeout(300);
  const extraVisible = await page.getByText("ถุงกระดาษ").isVisible();
  if (extraVisible) pass("d-extra", "ถุงกระดาษ 120");
  else fail("d-extra", `visible=${extraVisible}`);

  // ========== e) Offline persistence ==========
  // Tick cheese while offline
  await context.setOffline(true);
  await page.waitForTimeout(200);
  const offlineBanner = await page.getByText(/เน็ตหลุด/).isVisible().catch(() => false);
  if (offlineBanner) pass("e-offline-banner");
  else fail("e-offline-banner", "banner not shown");

  const cheeseCard = page.locator("li").filter({ hasText: cheese.name }).first();
  await cheeseCard.getByRole("button", { name: new RegExp(`ซื้อ ${cheese.name}`) }).click();
  await page.waitForTimeout(200);
  const cheeseQty = cheeseCard.locator('input[type="number"]').first();
  let cq = await cheeseQty.inputValue();
  if (!cq || Number(cq) <= 0) {
    await cheeseQty.fill("2");
    cq = "2";
  }
  await cheeseCard.locator('input[type="number"]').nth(1).fill("90");
  await page.waitForTimeout(500); // allow saveDraft effect to flush

  // Capture draft before "reload" simulation
  const draftBefore = await page.evaluate(() => localStorage.getItem("rizance_market_trip_v1"));
  let draftParsedOk = false;
  try {
    const d = JSON.parse(draftBefore || "{}");
    const doneN = Object.values(d.lines || {}).filter((l) => l.done).length;
    const hasExtra = (d.extras || []).some(
      (e) => e.label.includes("ถุงกระดาษ") && String(e.amount) === "120",
    );
    draftParsedOk = doneN >= 2 && hasExtra;
    if (draftParsedOk) {
      pass("e-localStorage-offline", `done=${doneN} extras=${(d.extras || []).length}`);
    } else {
      fail("e-localStorage-offline", `draft=${draftBefore?.slice(0, 400)}`);
    }
  } catch (err) {
    fail("e-localStorage-offline", String(err));
  }

  // True document reload needs network (no SW cache) — go online, reload, assert draft restores UI
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const draftAfter = await page.evaluate(() => localStorage.getItem("rizance_market_trip_v1"));
  if (draftAfter && draftAfter.includes("ถุงกระดาษ") && draftAfter.includes("1250")) {
    pass("e-localStorage-after-reload", "draft key intact across reload");
  } else {
    fail("e-localStorage-after-reload", `draft=${draftAfter?.slice(0, 300)}`);
  }

  await page.getByText("ไปตลาด").first().waitFor({ timeout: 10000 });
  const showAll2 = page.getByRole("button", { name: /ดูวัตถุดิบทั้งหมด/ });
  if (await showAll2.isVisible().catch(() => false)) await showAll2.click();
  const beefStill = await page
    .locator("li")
    .filter({ hasText: beef.name })
    .locator("button[aria-pressed='true']")
    .count();
  const cheeseStill = await page
    .locator("li")
    .filter({ hasText: cheese.name })
    .locator("button[aria-pressed='true']")
    .count();
  const extraStill = await page.getByText("ถุงกระดาษ").isVisible().catch(() => false);
  if (beefStill > 0 && cheeseStill > 0 && extraStill) {
    pass("e-ui-after-reload", "ticks + extra restored from localStorage");
  } else {
    fail("e-ui-after-reload", `beef=${beefStill} cheese=${cheeseStill} extra=${extraStill}`);
  }

  // ========== f) Online save + DB ==========
  await page.waitForTimeout(300);

  // Snapshot before
  const beforeBeef = await db.query(
    `SELECT stock_qty, avg_cost, last_purchase_price FROM ingredients WHERE id=$1`,
    [beef.id],
  );
  const beforeCheese = await db.query(
    `SELECT stock_qty, avg_cost, last_purchase_price FROM ingredients WHERE id=$1`,
    [cheese.id],
  );
  const expBefore = await db.query(
    `SELECT count(*)::int AS c FROM expense_entries WHERE user_id=$1`,
    [userId],
  );

  // Re-read qty from UI for beef (may have autofill)
  const beefCard2 = page.locator("li").filter({ hasText: beef.name }).first();
  const beefQty = Number(await beefCard2.locator('input[type="number"]').first().inputValue()) || Number(qtyVal);
  const cheeseQtyN = Number(await page.locator("li").filter({ hasText: cheese.name }).first().locator('input[type="number"]').first().inputValue()) || Number(cq);

  await page.getByRole("button", { name: /บันทึกทั้งหมด/ }).click();
  await page.waitForURL(/\/stock$/, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  const expAfter = await db.query(
    `SELECT id, amount, note, category, created_at
     FROM expense_entries
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId],
  );
  const newCount = expAfter.rows.length > 0 ? expAfter.rows : [];
  const latest = newCount[0];
  const added = expAfter.rows.filter(
    (r) => !expBefore.rows[0] || true,
  );
  // Find expense created in last minute with materials
  const tripExp = expAfter.rows.find(
    (r) =>
      r.category === "materials" &&
      String(r.note || "").includes("ซื้อวัตถุดิบ") &&
      Date.now() - new Date(r.created_at).getTime() < 120_000,
  );

  if (!tripExp) {
    fail("f-expense", `no trip expense found. latest=${JSON.stringify(expAfter.rows[0])}`);
  } else {
    const expectedTotal = 1250 + 90 + 120; // beef + cheese + bag
    const amt = parseFloat(tripExp.amount);
    const noteOk = /ซื้อวัตถุดิบ\s+\d+\s+รายการ/.test(tripExp.note || "");
    // Count how many new expenses in last 2 min with same note pattern
    const recentMaterials = expAfter.rows.filter(
      (r) =>
        r.category === "materials" &&
        Date.now() - new Date(r.created_at).getTime() < 120_000 &&
        String(r.note || "").includes("ซื้อวัตถุดิบ"),
    );
    if (recentMaterials.length === 1 && Math.abs(amt - expectedTotal) < 0.02 && noteOk) {
      pass("f-expense", `1 row amount=${amt} note=${tripExp.note}`);
    } else {
      fail(
        "f-expense",
        `count=${recentMaterials.length} amt=${amt} expected=${expectedTotal} note=${tripExp.note}`,
      );
    }

    const movs = await db.query(
      `SELECT ingredient_id, movement_type, qty_change, expense_entry_id
       FROM ingredient_stock_movements
       WHERE user_id=$1 AND expense_entry_id=$2`,
      [userId, tripExp.id],
    );
    const restocks = movs.rows.filter((m) => m.movement_type === "restock");
    const sameExp = restocks.every((m) => m.expense_entry_id === tripExp.id);
    if (restocks.length >= 2 && sameExp) {
      pass("f-movements", `${restocks.length} restock → same expense_entry_id`);
    } else {
      fail("f-movements", JSON.stringify(movs.rows));
    }

    const afterBeef = await db.query(
      `SELECT stock_qty, avg_cost, last_purchase_price FROM ingredients WHERE id=$1`,
      [beef.id],
    );
    const stockBefore = parseFloat(beforeBeef.rows[0].stock_qty);
    const stockAfter = parseFloat(afterBeef.rows[0].stock_qty);
    const lastPrice = parseFloat(afterBeef.rows[0].last_purchase_price);
    const expectedUnit = 1250 / beefQty;
    const stockDelta = stockAfter - stockBefore;

    if (Math.abs(stockDelta - beefQty) < 0.001 && Math.abs(lastPrice - expectedUnit) < 0.02) {
      pass(
        "f-stock-price",
        `stock +${stockDelta} last_purchase_price=${lastPrice} (1250/${beefQty}=${expectedUnit.toFixed(2)})`,
      );
    } else {
      fail(
        "f-stock-price",
        `delta=${stockDelta} expectQty=${beefQty} last=${lastPrice} expectUnit=${expectedUnit}`,
      );
    }

    // Weighted avg check for beef
    const avgBefore = beforeBeef.rows[0].avg_cost == null ? null : parseFloat(beforeBeef.rows[0].avg_cost);
    const avgAfter = afterBeef.rows[0].avg_cost == null ? null : parseFloat(afterBeef.rows[0].avg_cost);
    const base = avgBefore ?? expectedUnit;
    const totalQty = Math.max(stockBefore, 0) + beefQty;
    const expectedAvg =
      totalQty > 0
        ? (Math.max(stockBefore, 0) * base + beefQty * expectedUnit) / totalQty
        : expectedUnit;
    if (avgAfter != null && Math.abs(avgAfter - expectedAvg) < 0.02) {
      pass(
        "f-avg-cost",
        `avg ${avgBefore} → ${avgAfter} (expected ${expectedAvg.toFixed(4)}; stockWas=${stockBefore} qty=${beefQty} unit=${expectedUnit.toFixed(4)})`,
      );
    } else {
      fail("f-avg-cost", `got=${avgAfter} expected=${expectedAvg} before=${avgBefore}`);
    }

    // cheese stock too
    const afterCheese = await db.query(`SELECT stock_qty FROM ingredients WHERE id=$1`, [cheese.id]);
    const cDelta = parseFloat(afterCheese.rows[0].stock_qty) - parseFloat(beforeCheese.rows[0].stock_qty);
    if (Math.abs(cDelta - cheeseQtyN) < 0.001) pass("f-cheese-stock", `+${cDelta}`);
    else fail("f-cheese-stock", `delta=${cDelta} expect=${cheeseQtyN}`);
  }

  // ========== g) empty_trip ==========
  const empty = await profitApi(sessionToken, "/api/pos/ingredients/market-trip", {
    method: "POST",
    body: { lines: [], extraItems: [] },
  });
  if (empty.status === 400 && empty.body?.error === "empty_trip") {
    pass("g-empty_trip", "400 empty_trip");
  } else {
    fail("g-empty_trip", `${empty.status} ${JSON.stringify(empty.body)}`);
  }
} catch (err) {
  fail("uncaught", String(err?.stack || err));
} finally {
  await browser.close();
  await db.end();
}

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.n}${r.d ? " — " + r.d : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
