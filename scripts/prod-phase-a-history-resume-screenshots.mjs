/**
 * Resume Phase-A history screenshots (02–05 only).
 * Starts from /history with bill 20260711-001 (paid), then follows click steps exactly.
 * Usage: node scripts/prod-phase-a-history-resume-screenshots.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-screenshots");
mkdirSync(OUT, { recursive: true });

const PROFIT = "https://rizance.app";
const POS = "https://pos.rizance.app";
const BILL_NO = "20260711-001";
const stamp = Date.now();
const email = `phase-a-resume-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;
const productName = "Berger Salamy";

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

async function ensureStartingState(page) {
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
          shopName: "Phase A History Shop",
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
  const userId = reg.body?.data?.user?.id;

  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  await pool.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await pool.end();

  await page.context().clearCookies();
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
  if (prod.status !== 201) throw new Error(`product ${prod.status}`);
  const productId = prod.body?.data?.id;

  const bill = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId, qty: 1 }],
      paymentMethod: "promptpay",
    }),
  });
  if (bill.status !== 201) throw new Error(`bill ${bill.status}`);
  const billNo = bill.body?.data?.bill?.billNo;
  if (billNo !== BILL_NO) {
    console.warn(`expected ${BILL_NO}, got ${billNo}`);
  }

  return { userId, productId, billId: bill.body?.data?.bill?.id, billNo };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
let userId = null;
let productId = null;
let billId = null;

try {
  const setup = await ensureStartingState(page);
  userId = setup.userId;
  productId = setup.productId;
  billId = setup.billId;
  console.log("setup ok", { userId, billNo: setup.billNo });

  // ── ขั้น 1 → history-02-void-confirm.png ─────────────────────────────
  console.log("\n[ขั้น 1] desktop /history → เปิดบิล → ยกเลิกบิลนี้ → ถ่าย 02");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });

  const billRow = page.getByRole("button").filter({ hasText: BILL_NO });
  await billRow.waitFor({ timeout: 10000 });
  await billRow.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();

  await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
  await page.locator("textarea").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "ยืนยันยกเลิก" }).waitFor();
  await page.getByRole("button", { name: "ไม่ยกเลิก" }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "history-02-void-confirm.png"),
    fullPage: false,
  });
  console.log("shot history-02-void-confirm.png (ยังไม่กดยืนยัน)");

  // ── ขั้น 2 → history-03-list-after-void.png ─────────────────────────
  console.log("\n[ขั้น 2] พิมพ์เหตุผล → ยืนยันยกเลิก → รอ 2s → ถ่าย 03");
  await page.locator("textarea").fill("ทดสอบ");
  await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();
  await page.waitForTimeout(2000);
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.getByText("ยกเลิกแล้ว").first().waitFor({ timeout: 15000 });
  await page.screenshot({
    path: join(OUT, "history-03-list-after-void.png"),
    fullPage: true,
  });
  console.log("shot history-03-list-after-void.png");

  // ── ขั้น 3 → history-04-mobile-390.png ───────────────────────────────
  console.log("\n[ขั้น 3] resize 390px → goto /history → ถ่าย 04");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  if (!page.url().includes("/history")) {
    throw new Error(`expected /history URL, got ${page.url()}`);
  }
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
  const historyTab = page.locator('nav[aria-label="เมนูหลัก"] a[aria-current="page"]');
  await historyTab.waitFor({ timeout: 10000 });
  const tabText = await historyTab.innerText();
  if (!tabText.includes("ประวัติบิล")) {
    throw new Error(`expected ประวัติบิล tab active, got: ${tabText}`);
  }
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "history-04-mobile-390.png"),
    fullPage: true,
  });
  console.log("shot history-04-mobile-390.png");

  // ── ขั้น 4 → history-05-detail-sheet-390.png ───────────────────────
  console.log("\n[ขั้น 4] คลิกบิล 20260711-001 → bottom-sheet → ถ่าย 05");
  const voidedRow = page.getByRole("button").filter({ hasText: BILL_NO });
  await voidedRow.waitFor({ timeout: 10000 });
  await voidedRow.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.locator('[role="dialog"]').waitFor({ timeout: 10000 });
  await page.getByText("ยอดรวม").waitFor({ timeout: 15000 });
  await page.getByText("ยกเลิกแล้ว").nth(1).waitFor({ timeout: 15000 });
  await page.getByText(/เหตุผล:/).waitFor({ timeout: 15000 });
  await page.getByText(BILL_NO).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(OUT, "history-05-detail-sheet-390.png"),
    fullPage: true,
  });
  console.log("shot history-05-detail-sheet-390.png");

  console.log(`\nOUT=${OUT}`);
} finally {
  if (userId) {
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      if (billId) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE bill_id = $1`, [billId]);
        await pool.query(`DELETE FROM pos_bill_items WHERE bill_id = $1`, [billId]);
        await pool.query(`DELETE FROM pos_bills WHERE id = $1`, [billId]);
      }
      if (productId) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = $1`, [productId]);
        await pool.query(`DELETE FROM pos_bill_items WHERE product_id = $1`, [productId]);
        await pool.query(`DELETE FROM pos_products WHERE id = $1`, [productId]);
      }
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [
        userId,
      ]);
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
