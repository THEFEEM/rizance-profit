/**
 * Step-5 history screenshots for review (desktop void flow + 390px mobile).
 * Usage: node scripts/prod-history-step5-screenshots.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-history-step5");
mkdirSync(OUT, { recursive: true });

const PROFIT = "https://rizance.app";
const POS = "https://pos.rizance.app";
const stamp = Date.now();
const email = `hist-shot-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;
const productName = `Shot Product ${stamp}`;

function loadDatabaseUrl() {
  for (const file of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // skip
    }
  }
  throw new Error("DATABASE_URL not found");
}

function pgPoolOptions(connectionString) {
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  return {
    connectionString: url.toString().replace(/^postgres:/, "postgresql:"),
    ssl: { rejectUnauthorized: false },
  };
}

async function posApi(page, path, init = {}) {
  return page.evaluate(
    async ({ profit, posOrigin, path, init }) => {
      const res = await fetch(`${profit}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Origin: posOrigin,
          ...(init.headers ?? {}),
        },
        body: init.body,
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, body, text };
    },
    {
      profit: PROFIT,
      posOrigin: POS,
      path,
      init: { method: init.method, body: init.body, headers: init.headers },
    },
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
let userId = null;
const productIds = [];
const billIds = [];

try {
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
  const reg = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          shopName: "History Shot Shop",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register failed ${reg.status}`);
  }
  userId = reg.body?.data?.user?.id;
  console.log("user", userId);

  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  await pool.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await pool.end();

  await context.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30000 });

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });

  const prod = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: productName,
      sellPrice: 150,
      costPrice: 40,
      stockQty: 20,
    }),
  });
  if (prod.status !== 201) throw new Error(`product ${prod.status} ${prod.text}`);
  const productId = prod.body?.data?.id;
  productIds.push(productId);

  const bill = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId, qty: 2 }],
      paymentMethod: "cash",
    }),
  });
  if (bill.status !== 201) throw new Error(`bill ${bill.status}`);
  const billId = bill.body?.data?.bill?.id;
  const billNo = bill.body?.data?.bill?.billNo;
  billIds.push(billId);
  console.log("bill", billNo, billId);

  // Desktop void flow
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });

  const billRow = page.getByRole("button").filter({ hasText: billNo });
  await billRow.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).waitFor({ timeout: 10000 });
  await page.screenshot({
    path: join(OUT, "01-detail-before-void.png"),
    fullPage: true,
  });
  console.log("shot 01-detail-before-void.png");

  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();
  await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
  await page.locator("textarea").fill(`เหตุผลถ่ายภาพ ${stamp}`);
  // Wait for confirm actions; capture viewport (confirm sheet sits on top)
  await page.getByRole("button", { name: "ยืนยันยกเลิก" }).waitFor();
  await page.getByRole("button", { name: "ไม่ยกเลิก" }).waitFor();
  await page.locator("textarea").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(OUT, "02-void-confirm-sheet.png"),
    fullPage: false,
  });
  console.log("shot 02-void-confirm-sheet.png");

  await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();
  await page.waitForSelector('[role="status"]', { timeout: 15000 });
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  // Sheets may not use role=dialog — wait for toast + voided badge
  await page.getByText("ยกเลิกแล้ว").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(OUT, "03-list-after-void.png"),
    fullPage: true,
  });
  console.log("shot 03-list-after-void.png");

  // Mobile 390px — need a paid bill again for detail sheet
  const bill2 = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId, qty: 1 }],
      paymentMethod: "promptpay",
    }),
  });
  if (bill2.status !== 201) throw new Error(`bill2 ${bill2.status}`);
  const billNo2 = bill2.body?.data?.bill?.billNo;
  billIds.push(bill2.body?.data?.bill?.id);
  console.log("bill2", billNo2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "04-history-390.png"),
    fullPage: true,
  });
  console.log("shot 04-history-390.png");

  const bill2Row = page.getByRole("button").filter({ hasText: billNo2 });
  await bill2Row.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByText("ยอดรวม").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).waitFor({ timeout: 10000 });
  // Scroll sheet content into view on mobile bottom-sheet
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "05-detail-sheet-390.png"),
    fullPage: true,
  });
  console.log("shot 05-detail-sheet-390.png");

  console.log(`\nOUT=${OUT}`);
} finally {
  if (userId) {
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      if (productIds.length) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await pool.query(`DELETE FROM pos_bill_items WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
      }
      if (billIds.length) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE bill_id = ANY($1::uuid[])`, [
          billIds,
        ]);
        await pool.query(`DELETE FROM pos_bill_items WHERE bill_id = ANY($1::uuid[])`, [billIds]);
        await pool.query(`DELETE FROM pos_bills WHERE id = ANY($1::uuid[])`, [billIds]);
      }
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [
        userId,
      ]);
      if (productIds.length) {
        await pool.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      await pool.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("cleanup ok");
    } finally {
      await pool.end();
    }
  }
  await page.close();
  await context.close();
  await browser.close();
}
