/**
 * Capture products edit-prefill + empty-state screenshots (fullPage: false).
 * Usage: node scripts/capture-products-05-06.mjs
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
    { profit: PROFIT, path, init: { method: init.method, body: init.body } },
  );
}

async function registerBusiness(page, email, password, shopName) {
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
  const reg = await page.evaluate(
    async ({ email, password, shopName }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, shopName, mode: "regular" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password, shopName },
  );
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register ${reg.status}`);
  }
  const userId = reg.body?.data?.user?.id;
  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  await pool.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await pool.end();

  await page.context().clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').waitFor({ timeout: 15000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 45000 });
  return userId;
}

async function cleanupUser(userId, productIds = []) {
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
  } finally {
    await pool.end();
  }
}

const browser = await chromium.launch({ headless: true });
const userIds = [];
const productIds = [];

try {
  // ─── Shot 05: edit prefill ─────────────────────────────────────────
  {
    const email = `prod-edit-${stamp}@rizance.test`;
    const password = `Shot${stamp}!`;
    const context = await browser.newContext({ viewport: { width: 768, height: 900 } });
    const page = await context.newPage();
    const userId = await registerBusiness(page, email, password, "Edit Prefill Shop");
    userIds.push(userId);

    const created = await posApi(page, "/api/pos/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Berger Salamy",
        sellPrice: 150,
        costPrice: 40,
        stockQty: 20,
        unit: "ชิ้น",
      }),
    });
    if (created.status !== 201) throw new Error(`create ${created.status} ${created.text}`);
    productIds.push(created.body?.data?.id);

    await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("h1:has-text('จัดการสินค้า')", { timeout: 15000 });
    await page.getByText("Berger Salamy").waitFor({ timeout: 10000 });

    const card = page.locator("li").filter({ hasText: "Berger Salamy" });
    await card.getByRole("button", { name: "แก้ไข" }).click();
    await page.waitForSelector("h2:has-text('แก้ไขสินค้า')", { timeout: 10000 });

    const nameVal = await page.locator('input[placeholder="ชื่อสินค้า"]').inputValue();
    const priceVal = await page.locator('input[placeholder="ราคาขาย"]').inputValue();
    const costVal = await page.locator('input[placeholder="ต้นทุน"]').inputValue();
    const unitVal = await page.locator('input[placeholder="ถ้วย, ชิ้น"]').inputValue();
    console.log("prefill", { nameVal, priceVal, costVal, unitVal });

    if (nameVal !== "Berger Salamy") throw new Error(`name prefill wrong: ${nameVal}`);
    if (!priceVal.includes("150")) throw new Error(`price prefill wrong: ${priceVal}`);

    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT, "products-05-edit-prefill.png"),
      fullPage: false,
    });
    console.log("shot products-05-edit-prefill.png");

    await page.close();
    await context.close();
  }

  // ─── Shot 06: empty state (fresh account, no products) ─────────────
  {
    const email = `prod-empty-${stamp}@rizance.test`;
    const password = `Shot${stamp}E!`;
    const context = await browser.newContext({ viewport: { width: 768, height: 900 } });
    const page = await context.newPage();
    const userId = await registerBusiness(page, email, password, "Empty Products Shop");
    userIds.push(userId);

    await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("h1:has-text('จัดการสินค้า')", { timeout: 15000 });

    const bodyText = await page.locator("body").innerText();
    console.log("empty body snippet:", bodyText.slice(0, 400).replace(/\n/g, " | "));

    const hasPackagePlusTitle = bodyText.includes("เพิ่มสินค้าแรกของร้าน");
    const hasDesc = bodyText.includes("แล้วเริ่มขายได้เลย");
    const hasCta = await page.getByRole("button", { name: "เพิ่มสินค้า" }).count();

    console.log("empty checks", { hasPackagePlusTitle, hasDesc, hasCta });

    if (!hasPackagePlusTitle || !hasDesc) {
      console.error("EMPTY_STATE_MISMATCH — reporting, not fixing");
    }

    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT, "products-06-empty-state.png"),
      fullPage: false,
    });
    console.log("shot products-06-empty-state.png");

    await page.close();
    await context.close();
  }

  console.log(`\nOUT=${OUT}`);
} finally {
  for (const uid of userIds) {
    try {
      await cleanupUser(uid, productIds.splice(0, productIds.length));
      console.log("cleanup", uid);
    } catch (e) {
      console.error("cleanup fail", uid, e);
    }
  }
  // second user has no products — clean remaining ids if any leftover from first
  await browser.close();
}
