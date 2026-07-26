/**
 * Phase-A products screenshots @ 768px + 390px (fullPage: false only).
 * Requires local profit :3000 and pos :3001 running.
 * Usage: node scripts/capture-products-phase-a.mjs
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

const PROFIT = process.env.PROFIT_URL || "http://localhost:3000";
const POS = process.env.POS_URL || "http://localhost:3001";
const stamp = Date.now();
const email = `products-shot-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;

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
    async ({ profit, path, init }) => {
      const res = await fetch(`${profit}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
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
      path,
      init: { method: init.method, body: init.body },
    },
  );
}

const browser = await chromium.launch({ headless: true });
let userId = null;
const productIds = [];

try {
  const context768 = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const page = await context768.newPage();

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
          shopName: "Phase A Products Shop",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register ${reg.status}`);
  userId = reg.body?.data?.user?.id;

  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  await pool.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await pool.end();

  await context768.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30000 });

  const p1 = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Berger Salamy",
      sellPrice: 150,
      costPrice: 40,
      stockQty: 20,
      unit: "ชิ้น",
    }),
  });
  if (p1.status !== 201) throw new Error(`p1 ${p1.status}`);
  productIds.push(p1.body?.data?.id);

  const p2 = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Low Stock Item",
      sellPrice: 89,
      costPrice: 20,
      stockQty: 3,
    }),
  });
  if (p2.status !== 201) throw new Error(`p2 ${p2.status}`);
  productIds.push(p2.body?.data?.id);

  const p3 = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Inactive Snack",
      sellPrice: 45,
      stockQty: 10,
    }),
  });
  if (p3.status !== 201) throw new Error(`p3 ${p3.status}`);
  const p3Id = p3.body?.data?.id;
  productIds.push(p3Id);

  await posApi(page, `/api/pos/products/${p3Id}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });

  // 1. List @768px
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('จัดการสินค้า')", { timeout: 15000 });
  await page.getByText("Berger Salamy").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "products-01-list-768.png"),
    fullPage: false,
  });
  console.log("shot products-01-list-768.png");

  // 2. Sheet เพิ่มสินค้า @768px
  await page.getByRole("button", { name: "เพิ่มสินค้า" }).click();
  await page.waitForSelector("h2:has-text('เพิ่มสินค้า')", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "products-02-sheet-add-768.png"),
    fullPage: false,
  });
  console.log("shot products-02-sheet-add-768.png");
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 5000 });

  // 3. List @390px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('จัดการสินค้า')", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "products-03-list-390.png"),
    fullPage: false,
  });
  console.log("shot products-03-list-390.png");

  // 4. Badge stock ต่ำ @390px (scroll Low Stock Item into view if needed)
  const lowRow = page.getByText("Low Stock Item");
  await lowRow.scrollIntoViewIfNeeded();
  await page.getByText("เหลือ 3").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "products-04-low-stock-390.png"),
    fullPage: false,
  });
  console.log("shot products-04-low-stock-390.png");

  console.log(`\nOUT=${OUT}`);
  await page.close();
  await context768.close();
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
        await pool.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      await pool.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("cleanup ok");
    } finally {
      await pool.end();
    }
  }
  await browser.close();
}
