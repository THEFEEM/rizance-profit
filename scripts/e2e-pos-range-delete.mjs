/**
 * Phase A+B: range dashboard + hard-delete product
 * Usage: node scripts/e2e-pos-range-delete.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `range-e2e-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;
const PRODUCT_NAME = `DelMe ${stamp}`;

const results = [];
function pass(n, d = "") {
  results.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
}
function fail(n, d) {
  results.push({ n, ok: false, d });
  console.log(`FAIL ${n}: ${d}`);
}

function loadDb() {
  for (const f of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* skip */
    }
  }
  throw new Error("no DATABASE_URL");
}

function pool() {
  return new pg.Pool(pgClientOptions(loadDb()));
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
let userId = null;
const productIds = [];
let keepProductId = null;
let deleteProductId = null;
let imageUrl = null;

try {
  const today = todayLocal();
  const weekStart = mondayOf(today);
  const weekEnd = today;
  const prevWeekEnd = addDays(weekStart, -1);
  const prevWeekStart = addDays(prevWeekEnd, -6);

  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  const reg = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          shopName: "RANGE E2E",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`reg ${reg.status}`);
  userId = reg.body?.data?.user?.id;

  {
    const p = pool();
    await p.query(
      `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
      [userId],
    );
    await p.end();
  }

  await context.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 45000 });

  async function createProduct(name, price) {
    const r = await page.evaluate(
      async ({ profit, name, price }) => {
        const res = await fetch(`${profit}/api/pos/products`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sellPrice: price, costPrice: 5, stockQty: 30 }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      { profit: PROFIT, name, price },
    );
    if (r.status !== 201) throw new Error(`create ${name}: ${r.status}`);
    productIds.push(r.body.data.id);
    return r.body.data;
  }

  async function closeCash(productId, amount) {
    const r = await page.evaluate(
      async ({ profit, productId, amount }) => {
        const res = await fetch(`${profit}/api/pos/bills`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ productId, qty: 1 }],
            payments: [{ method: "cash", amount }],
          }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      { profit: PROFIT, productId, amount },
    );
    if (r.status !== 201 && r.status !== 200) {
      throw new Error(`bill ${r.status} ${JSON.stringify(r.body)}`);
    }
    return r.body.data;
  }

  const pKeep = await createProduct("Keep Hist", 30);
  keepProductId = pKeep.id;
  const pDel = await createProduct(PRODUCT_NAME, 50);
  deleteProductId = pDel.id;
  const pA = await createProduct("WeekA 100", 100);
  const pB = await createProduct("WeekB 50", 50);

  // Upload 1x1 PNG
  const up = await page.evaluate(
    async ({ profit, id, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("file", new Blob([bin], { type: "image/png" }), "x.png");
      const res = await fetch(`${profit}/api/pos/products/${id}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    { profit: PROFIT, id: deleteProductId, b64: PNG_1X1.toString("base64") },
  );
  if (up.status === 200 || up.status === 201) {
    imageUrl = up.body?.data?.imageUrl || up.body?.data?.image_url || null;
  }
  if (!imageUrl) {
    const p = pool();
    const row = await p.query(`SELECT image_url FROM pos_products WHERE id = $1`, [deleteProductId]);
    imageUrl = row.rows[0]?.image_url;
    await p.end();
  }
  if (imageUrl) pass("upload_image", imageUrl.slice(0, 72));
  else fail("upload_image", JSON.stringify(up).slice(0, 200));

  // Seed: week 100+50, prev week 100, keep hist bill today
  const billA = await closeCash(pA.id, 100);
  const billB = await closeCash(pB.id, 50);
  const billKeep = await closeCash(keepProductId, 30);
  const billDel = await closeCash(deleteProductId, 50);
  const billPrev = await closeCash(pA.id, 100);

  // Seed dates:
  // - yesterday: 100 (for day ±%)
  // - today: 50+30+50 = 130
  // - prev week Mon (weekStart-7): 80 (for past-week daily sum + optional %)
  const yesterday = addDays(today, -1);
  const pastWeekMon = addDays(weekStart, -7);
  {
    const p = pool();
    await p.query(`UPDATE pos_bills SET entry_date = $2::date WHERE user_id = $1 AND bill_no = $3`, [
      userId,
      yesterday,
      billA.bill.billNo,
    ]);
    await p.query(`UPDATE pos_bills SET entry_date = $2::date WHERE user_id = $1 AND bill_no = $3`, [
      userId,
      pastWeekMon,
      billPrev.bill.billNo,
    ]);
    // bump prev bill amount display — already 100; also add note: use 100 on past week
    // B, keep, del remain today
    await p.end();
  }
  pass("seed_bills", `yesterday=${yesterday}/100 today=130 pastWeek=${pastWeekMon}/100`);

  // ── A1 API: multi-day range daily sum === paidTotal (past week Mon–Sun capped) ──
  const pastWeekEnd = addDays(pastWeekMon, 6);
  const sumWeek = await page.evaluate(
    async ({ profit, start, end }) => {
      const res = await fetch(`${profit}/api/pos/summary?start=${start}&end=${end}`, {
        credentials: "include",
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { profit: PROFIT, start: pastWeekMon, end: pastWeekEnd },
  );
  const sw = sumWeek.body?.data;
  if (!sw) {
    fail("api_week_summary", JSON.stringify(sumWeek).slice(0, 200));
  } else {
    const dailySum = (sw.daily || []).reduce((a, d) => a + parseFloat(d.total), 0);
    const paid = parseFloat(sw.paidTotal);
    if (Math.abs(dailySum - paid) < 0.001 && paid > 0 && (sw.daily?.length ?? 0) >= 2) {
      pass("week_daily_sum_eq_total", `${dailySum} = ${paid} over ${sw.daily?.length} days`);
    } else {
      fail("week_daily_sum_eq_total", `daily=${dailySum} paid=${paid} n=${sw.daily?.length}`);
    }
  }

  // ── A2 day ±%: today 130 vs yesterday 100 → +30% ──
  const sumDay = await page.evaluate(
    async ({ profit, start, end }) => {
      const res = await fetch(`${profit}/api/pos/summary?start=${start}&end=${end}`, {
        credentials: "include",
      });
      return { body: await res.json().catch(() => null) };
    },
    { profit: PROFIT, start: today, end: today },
  );
  const sd = sumDay.body?.data;
  if (!sd) {
    fail("api_day_summary", "null");
  } else {
    const cur = parseFloat(sd.paidTotal);
    const prev = parseFloat(sd.prev.paidTotal);
    const expectedPct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    if (prev === 100 && Math.abs(cur - 130) < 0.01) pass("day_totals_130_vs_100", `cur=${cur} prev=${prev}`);
    else fail("day_totals_130_vs_100", `cur=${cur} prev=${prev}`);

    await page.goto(`${POS}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByRole("button", { name: "วัน", exact: true }).click();
    await page.waitForTimeout(800);
    const dash = await page.locator("main").innerText();
    const want = expectedPct !== null ? expectedPct.toFixed(1) : null;
    if (want && (dash.includes(`${want}%`) || dash.includes(`+${want}%`))) {
      pass("ui_pct_card", `${want}%`);
    } else {
      const m = dash.match(/([+-]?\d+\.\d)%/);
      if (m && want && Math.abs(parseFloat(m[1]) - expectedPct) < 0.2) pass("ui_pct_card", `~${m[1]}`);
      else fail("ui_pct_card", `want ${want} ${dash.slice(0, 280).replace(/\n/g, " | ")}`);
    }
  }

  // UI week: go to previous week — total should match daily bars (API already checked)
  await page.getByRole("button", { name: "สัปดาห์", exact: true }).click();
  await page.getByRole("button", { name: /ก่อนหน้า/ }).click();
  await page.waitForTimeout(1000);
  const weekDash = await page.locator("main").innerText();
  if (/฿100\.00/.test(weekDash) || weekDash.includes("100.00")) pass("ui_past_week_total_100");
  else fail("ui_past_week_total_100", weekDash.slice(0, 200).replace(/\n/g, " | "));

  // back to current
  await page.getByRole("button", { name: /สัปดาห์นี้|วันนี้/ }).click();
  await page.waitForTimeout(400);

  // ── A3 next disabled ──
  await page.getByRole("button", { name: "วัน", exact: true }).click();
  await page.waitForTimeout(500);
  if (await page.getByRole("button", { name: /ถัดไป/ }).isDisabled()) pass("next_disabled_day");
  else fail("next_disabled_day", "enabled");

  await page.getByRole("button", { name: "สัปดาห์", exact: true }).click();
  await page.waitForTimeout(500);
  if (await page.getByRole("button", { name: /ถัดไป/ }).isDisabled()) pass("next_disabled_week");
  else fail("next_disabled_week", "enabled");

  await page.getByRole("button", { name: "เดือน", exact: true }).click();
  await page.waitForTimeout(500);
  if (await page.getByRole("button", { name: /ถัดไป/ }).isDisabled()) pass("next_disabled_month");
  else fail("next_disabled_month", "enabled");

  await page.getByRole("button", { name: "วัน", exact: true }).click();
  await page.getByRole("button", { name: /ก่อนหน้า/ }).click();
  await page.waitForTimeout(500);
  if (await page.getByRole("button", { name: /ถัดไป/ }).isEnabled()) pass("next_enabled_past_day");
  else fail("next_enabled_past_day", "disabled");

  // ── B delete product ──
  await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText(PRODUCT_NAME).first().waitFor({ timeout: 15000 });
  // Click the แก้ไข button on this product's card
  await page
    .locator("li")
    .filter({ hasText: PRODUCT_NAME })
    .getByRole("button", { name: "แก้ไข" })
    .click();
  await page.getByRole("heading", { name: "แก้ไขสินค้า" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "ลบสินค้านี้ถาวร" }).click();
  await page.getByRole("button", { name: "ลบถาวร" }).waitFor({ timeout: 5000 });

  await page.locator(`input[placeholder="${PRODUCT_NAME}"]`).fill("WRONG");
  await page.waitForTimeout(150);
  if (await page.getByRole("button", { name: "ลบถาวร" }).isDisabled()) {
    pass("delete_disabled_until_name");
  } else {
    fail("delete_disabled_until_name", "enabled with wrong name");
  }

  await page.locator(`input[placeholder="${PRODUCT_NAME}"]`).fill(PRODUCT_NAME);
  await page.waitForTimeout(150);
  if (await page.getByRole("button", { name: "ลบถาวร" }).isEnabled()) {
    pass("delete_enabled_on_exact_name");
  } else {
    fail("delete_enabled_on_exact_name", "still disabled");
  }

  await page.getByRole("button", { name: "ลบถาวร" }).click();
  await page.getByText("ลบสินค้าแล้ว").first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  {
    const p = pool();
    const gone = await p.query(`SELECT id FROM pos_products WHERE id = $1`, [deleteProductId]);
    if (gone.rows.length === 0) pass("db_product_deleted");
    else fail("db_product_deleted", "still exists");
    await p.end();
  }

  // Sell page: tile gone
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);
  const sellText = await page.locator("main").innerText();
  if (!sellText.includes(PRODUCT_NAME)) pass("sell_tile_gone");
  else fail("sell_tile_gone", "still visible");

  // History: old bill still shows name
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button").filter({ hasText: billDel.bill.billNo }).click();
  await page.getByText(PRODUCT_NAME).first().waitFor({ timeout: 15000 });
  const detail = await page.locator('[role="dialog"]').innerText();
  if (detail.includes(PRODUCT_NAME) && !/โหลดไม่สำเร็จ/.test(detail)) {
    pass("history_keeps_name", billDel.bill.billNo);
  } else {
    fail("history_keeps_name", detail.slice(0, 250).replace(/\n/g, " | "));
  }

  // Image gone from storage (check via Supabase API — CDN may cache public URL)
  if (imageUrl) {
    await page.waitForTimeout(1200);
    const pathMatch = imageUrl.match(/\/pos-menu\/(.+)$/) || imageUrl.match(/\/object\/public\/[^/]+\/(.+)$/);
    const objectPath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
    let storageGone = false;
    if (objectPath) {
      // load supabase creds from env files
      let supabaseUrl = "";
      let serviceKey = "";
      for (const f of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
        try {
          for (const line of readFileSync(f, "utf8").split("\n")) {
            const m = line.match(/^\s*(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
            if (m) {
              const v = m[2].trim().replace(/^["']|["']$/g, "");
              if (m[1] === "SUPABASE_URL") supabaseUrl = v;
              else serviceKey = v;
            }
          }
        } catch {
          /* skip */
        }
      }
      if (supabaseUrl && serviceKey) {
        const check = await fetch(
          `${supabaseUrl}/storage/v1/object/info/pos-menu/${objectPath}`,
          { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
        );
        storageGone = check.status === 404 || check.status === 400;
        if (!storageGone) {
          // try download
          const dl = await fetch(`${supabaseUrl}/storage/v1/object/pos-menu/${objectPath}`, {
            headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
          });
          storageGone = dl.status === 404 || dl.status === 400;
          if (!storageGone) {
            fail("image_removed_from_bucket", `info=${check.status} dl=${dl.status} path=${objectPath}`);
          }
        }
      }
    }
    if (storageGone) pass("image_removed_from_bucket", objectPath || "ok");
    else if (!objectPath) {
      const imgCheck = await page.evaluate(async (url) => {
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        return res.status;
      }, imageUrl);
      if (imgCheck === 404 || imgCheck === 400) pass("image_removed_from_bucket", `http ${imgCheck}`);
      else fail("image_removed_from_bucket", `http ${imgCheck} no path parse`);
    }
  } else {
    fail("image_removed_from_bucket", "no imageUrl");
  }

  // Keep product still on sell
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  if ((await page.getByText("Keep Hist").count()) > 0) pass("keep_product_still_there");
  else fail("keep_product_still_there", "missing");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:", failed);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (userId) {
    const p = pool();
    try {
      await p.query(
        `DELETE FROM pos_bill_payments WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await p.query(
        `DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await p.query(
        `DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await p.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      if (productIds.length) {
        await p.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await p.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      await p.query(`DELETE FROM income_entries WHERE user_id = $1`, [userId]);
      await p.query(
        `DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE user_id = $1)`,
        [userId],
      );
      await p.query(`DELETE FROM journal_entries WHERE user_id = $1`, [userId]);
      await p.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
      await p.query(`DELETE FROM pos_shop_settings WHERE user_id = $1`, [userId]).catch(() => {});
      await p.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("cleanup ok");
    } finally {
      await p.end();
    }
  }
  await page.close();
  await context.close();
  await browser.close();
}
