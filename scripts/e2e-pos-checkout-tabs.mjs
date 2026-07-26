/**
 * Quick smoke: checkout tabs cash / promptpay / thai_chuay_thai
 * Usage: node scripts/e2e-pos-checkout-tabs.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `tabs-e2e-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;

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

async function dismissOverlay(page) {
  const ov = page.locator("button.fixed").filter({ hasText: /รับเงินแล้ว|เงินทอน/ }).first();
  if (await ov.isVisible().catch(() => false)) {
    await ov.click({ force: true }).catch(() => {});
  }
  await page.getByText("รับเงินแล้ว").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem("rizance_pos_cart_v2", "[]");
    localStorage.removeItem("rizance_pos_cart_v2");
  });
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Tab Smoke").first().waitFor({ timeout: 15000 });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
let productId = null;

try {
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
          shopName: "TABS E2E",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`reg ${reg.status}`);
  userId = reg.body?.data?.user?.id;

  const p0 = pool();
  await p0.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await p0.end();

  await context.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 45000 });

  const created = await page.evaluate(async (profit) => {
    const res = await fetch(`${profit}/api/pos/products`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tab Smoke", sellPrice: 49, costPrice: 10, stockQty: 20 }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, PROFIT);
  if (created.status !== 201) throw new Error(`product ${created.status}`);
  productId = created.body.data.id;

  await page.evaluate(async (profit) => {
    await fetch(`${profit}/api/pos/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptpayId: "0812345678" }),
    });
  }, PROFIT);

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Tab Smoke").first().waitFor({ timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Tab Smoke").first().waitFor({ timeout: 15000 });

  // ── 1) Cash tab: change correct ──
  await page.getByText("Tab Smoke").first().click();
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  const tabs = page.locator('[role="dialog"] button').filter({ hasText: /^(เงินสด|PromptPay|ไทยช่วยไทย)$/ });
  if ((await tabs.count()) >= 3) pass("three_tabs_visible");
  else fail("three_tabs_visible", `count=${await tabs.count()}`);

  await page.getByRole("button", { name: "เงินสด", exact: true }).click();
  await page.getByLabel("รับเงินมา").fill("100");
  await page.waitForTimeout(200);
  const cashSheet = await page.locator('[role="dialog"]').innerText();
  if (/เงินทอน/.test(cashSheet) && /51\.00/.test(cashSheet)) pass("cash_change_51", "100-49=51");
  else fail("cash_change_51", cashSheet.slice(0, 250).replace(/\n/g, " | "));

  await page.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await page.getByText("รับเงินแล้ว").or(page.getByText("เงินทอน")).first().waitFor({ timeout: 15000 });
  pass("cash_checkout_ok");
  await dismissOverlay(page);
  // Hard reset cart before next tab
  await page.evaluate(() => {
    localStorage.setItem("rizance_pos_cart_v2", "[]");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Tab Smoke").first().waitFor({ timeout: 15000 });

  // ── 2) PromptPay: QR full amount ──
  await page.getByText("Tab Smoke").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  // Guard: must be single-item 49
  const ppOpen = await page.locator('[role="dialog"]').innerText();
  if (!/฿49\.00/.test(ppOpen)) {
    fail("promptpay_precheck_total", ppOpen.slice(0, 120).replace(/\n/g, " | "));
  }
  await page.getByRole("button", { name: "PromptPay", exact: true }).click();
  await page.waitForTimeout(500);
  const ppSheet = await page.locator('[role="dialog"]').innerText();
  // QR must embed the full bill total (matches ยอดที่ต้องชำระ)
  const totals = [...ppSheet.matchAll(/฿(\d+\.\d{2})/g)].map((m) => m[1]);
  const qrShowsFull =
    /THAI QR|PromptPay/i.test(ppSheet) &&
    totals.includes("49.00") &&
    /ยอดที่ต้องชำระ[\s\S]*฿49\.00/.test(ppSheet);
  if (qrShowsFull) {
    pass("promptpay_qr_full", "QR = bill total 49");
  } else {
    fail("promptpay_qr_full", ppSheet.slice(0, 300).replace(/\n/g, " | "));
  }
  await page.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await page.getByText("รับเงินแล้ว").first().waitFor({ timeout: 15000 });
  pass("promptpay_checkout_ok");
  await dismissOverlay(page);

  {
    const p = pool();
    const bill = await p.query(
      `SELECT payment_method, total_amount::text FROM pos_bills
       WHERE user_id = $1 AND payment_method = 'promptpay'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (bill.rows[0]?.payment_method === "promptpay") {
      pass("promptpay_bill_method", `${bill.rows[0].total_amount}`);
    } else fail("promptpay_bill_method", JSON.stringify(bill.rows[0]));
    await p.end();
  }

  await page.evaluate(() => localStorage.setItem("rizance_pos_cart_v2", "[]"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Tab Smoke").first().waitFor({ timeout: 15000 });

  // ── 3) Thai chuay thai → transfer income ──
  await page.getByText("Tab Smoke").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await page.getByRole("button", { name: "ไทยช่วยไทย", exact: true }).click();
  await page.waitForTimeout(200);
  const thaiSheet = await page.locator('[role="dialog"]').innerText();
  if (/ไทยช่วยไทย|ถุงเงิน/.test(thaiSheet)) pass("thai_tab_copy");
  else fail("thai_tab_copy", thaiSheet.slice(0, 200).replace(/\n/g, " | "));

  await page.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
  await page.getByText("รับเงินแล้ว").first().waitFor({ timeout: 15000 });
  pass("thai_checkout_ok");
  await dismissOverlay(page);

  {
    const p = pool();
    const bill = await p.query(
      `SELECT id, payment_method, total_amount::text FROM pos_bills
       WHERE user_id = $1 AND payment_method = 'thai_chuay_thai'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (bill.rows[0]?.payment_method === "thai_chuay_thai") {
      pass("thai_bill_method", bill.rows[0].payment_method);
    } else fail("thai_bill_method", JSON.stringify(bill.rows[0]));

    const income = await p.query(
      `SELECT payment_method, amount::text FROM income_entries
       WHERE user_id = $1 AND note LIKE 'POS%' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (income.rows[0]?.payment_method === "transfer" && parseFloat(income.rows[0]?.amount) === 49) {
      pass("thai_income_transfer", "transfer 49");
    } else fail("thai_income_transfer", JSON.stringify(income.rows[0]));
    await p.end();
  }

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
      if (productId) {
        await p.query(`DELETE FROM pos_stock_movements WHERE product_id = $1`, [productId]);
        await p.query(`DELETE FROM pos_products WHERE id = $1`, [productId]);
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
