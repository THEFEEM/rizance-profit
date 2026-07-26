/**
 * Verify costPrice prefill + sell catalog has no costPrice.
 * Usage: node scripts/verify-cost-include.mjs
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
const email = `cost-fix-${stamp}@rizance.test`;
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
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 768, height: 900 } });
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
          shopName: "Cost Fix Shop",
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

  await context.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 45000 });

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
  if (created.status !== 201) throw new Error(`create ${created.status}`);
  productId = created.body?.data?.id;

  // Regression: default catalog must NOT include costPrice
  const sellCatalog = await posApi(page, "/api/pos/products");
  const sellProducts = sellCatalog.body?.data?.products ?? [];
  const sellHasCost = sellProducts.some((p) => Object.prototype.hasOwnProperty.call(p, "costPrice"));
  if (sellHasCost) throw new Error("REGRESSION: sell catalog includes costPrice");
  console.log("PASS sell catalog has no costPrice keys");

  // Management catalog with includeCost
  const mgmt = await posApi(page, "/api/pos/products?includeInactive=1&includeCost=1");
  const mgmtProduct = (mgmt.body?.data?.products ?? []).find((p) => p.id === productId);
  if (!mgmtProduct || mgmtProduct.costPrice !== "40.00" && mgmtProduct.costPrice !== "40") {
    throw new Error(`mgmt costPrice wrong: ${JSON.stringify(mgmtProduct)}`);
  }
  console.log("PASS mgmt catalog costPrice=", mgmtProduct.costPrice);

  await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Berger Salamy").waitFor({ timeout: 15000 });
  await page.locator("li").filter({ hasText: "Berger Salamy" }).getByRole("button", { name: "แก้ไข" }).click();
  await page.waitForSelector("h2:has-text('แก้ไขสินค้า')", { timeout: 10000 });

  const costVal = await page.locator('input[placeholder="ต้นทุน"]').inputValue();
  console.log("cost field value:", costVal);
  if (costVal !== "40.00" && costVal !== "40") {
    throw new Error(`cost field empty/wrong: ${costVal}`);
  }

  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "products-05-edit-prefill.png"),
    fullPage: false,
  });
  console.log("shot products-05-edit-prefill.png");

  // Sell page: no cost text in UI
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Berger Salamy").waitFor({ timeout: 15000 });
  const sellBody = await page.locator("body").innerText();
  if (sellBody.includes("ต้นทุน") || sellBody.includes("40.00")) {
    // 150.00 is sell price — check specifically cost label
    if (sellBody.includes("ต้นทุน")) throw new Error("sell page shows ต้นทุน");
  }
  // Network: sell page fetch should not use includeCost
  const sellFetch = await page.evaluate(async (profit) => {
    const res = await fetch(`${profit}/api/pos/products`, { credentials: "include" });
    const body = await res.json();
    return body?.data?.products?.[0] ?? null;
  }, PROFIT);
  if (sellFetch && Object.prototype.hasOwnProperty.call(sellFetch, "costPrice")) {
    throw new Error("sell fetch still has costPrice key");
  }
  console.log("PASS sell page UI/API no cost leak");
  console.log(`\nOUT=${OUT}`);
} finally {
  if (userId) {
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      if (productId) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = $1`, [productId]);
        await pool.query(`DELETE FROM pos_bill_items WHERE product_id = $1`, [productId]);
        await pool.query(`DELETE FROM pos_products WHERE id = $1`, [productId]);
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
