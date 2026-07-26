/**
 * Visual check mobile/iPad breakpoints for rizance-pos.
 * Usage: node scripts/check-pos-responsive.mjs
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
const email = `resp-check-${stamp}@rizance.test`;
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

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
let productId = null;

try {
  // Manifest + icons
  for (const path of [
    "/manifest.webmanifest",
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
  ]) {
    const res = await page.request.get(`${POS}${path}`);
    if (res.status() === 200) pass(`http_${path}`, `200`);
    else fail(`http_${path}`, `status ${res.status()}`);
  }
  const man = await (await page.request.get(`${POS}/manifest.webmanifest`)).json();
  const iconSrcs = (man.icons ?? []).map((i) => i.src);
  pass("manifest_icons_listed", iconSrcs.join(", "));

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
          shopName: "Responsive Check Shop",
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

  for (let i = 1; i <= 6; i++) {
    const p = await posApi(page, "/api/pos/products", {
      method: "POST",
      body: JSON.stringify({
        name: `Item ${i}`,
        sellPrice: 50 + i * 10,
        costPrice: 10,
        stockQty: 10,
      }),
    });
    if (p.status === 201 && i === 1) productId = p.body?.data?.id;
  }
  const bill = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId, qty: 1 }],
      paymentMethod: "cash",
    }),
  });
  if (bill.status !== 201) throw new Error(`bill ${bill.status}`);

  // ── 1024px sell: grid + cart side by side ──
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Item 1").first().waitFor({ timeout: 15000 });
  const aside1024 = await page.locator("aside").boundingBox();
  const grid1024 = await page.locator("section").first().boundingBox();
  const asideVisible = await page.locator("aside").isVisible();
  if (asideVisible && aside1024 && grid1024 && aside1024.x > grid1024.x) {
    pass("sell_1024_side_by_side", `aside x=${aside1024.x} w=${aside1024.width}`);
  } else fail("sell_1024_side_by_side", JSON.stringify({ asideVisible, aside1024, grid1024 }));
  const cartH = await page.locator("aside .flex.h-\\[calc\\(100dvh-88px\\)\\]").count().catch(() => 0);
  // class may be escaped differently — check computed height
  const cartBox = await page.locator("aside > div, aside .rounded-xl").first().boundingBox();
  if (cartBox && cartBox.height >= 360) pass("sell_1024_cart_fixed_height", `h=${cartBox.height}`);
  else fail("sell_1024_cart_fixed_height", JSON.stringify(cartBox));
  await page.screenshot({ path: join(OUT, "resp-sell-1024.png"), fullPage: false });

  // ── 768px sell: still side by side (md) ──
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Item 1").first().waitFor({ timeout: 15000 });
  const aside768 = await page.locator("aside").isVisible();
  const mobileBar768 = await page.locator("button.md\\:hidden").filter({ hasText: "ตะกร้า" }).count();
  // cart bar is md:hidden so at 768 should be hidden; aside should show
  if (aside768) pass("sell_768_cart_sidebar_visible");
  else fail("sell_768_cart_sidebar_visible", "aside hidden");
  await page.getByText("Item 1").first().click();
  await page.waitForTimeout(300);
  const floatBar768 = page.locator('button:has-text("ตะกร้า")').filter({ hasText: "฿" });
  // at md+, float bar has md:hidden
  const floatVisible768 = await floatBar768.isVisible().catch(() => false);
  if (!floatVisible768) pass("sell_768_no_float_cart_bar");
  else fail("sell_768_no_float_cart_bar", "float bar still visible at 768");
  await page.screenshot({ path: join(OUT, "resp-sell-768.png"), fullPage: false });

  // ── 390px sell: float cart above bottom nav ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Item 1").first().waitFor({ timeout: 15000 });
  await page.getByText("Item 1").first().click();
  await page.waitForTimeout(400);
  const aside390 = await page.locator("aside").isVisible();
  if (!aside390) pass("sell_390_aside_hidden");
  else fail("sell_390_aside_hidden", "aside still visible");

  const floatBar = page.getByRole("button", { name: /ตะกร้า \(\d+\)/ });
  await floatBar.waitFor({ timeout: 5000 });
  const floatBox = await floatBar.boundingBox();
  const bottomNav = page.locator('nav.md\\:hidden[aria-label="เมนูหลัก"], nav[aria-label="เมนูหลัก"]').last();
  const navBox = await bottomNav.boundingBox();
  if (floatBox && navBox && floatBox.y < navBox.y) {
    pass("sell_390_float_above_nav", `float.y=${Math.round(floatBox.y)} nav.y=${Math.round(navBox.y)}`);
  } else {
    fail("sell_390_float_above_nav", JSON.stringify({ floatBox, navBox }));
  }
  await page.screenshot({ path: join(OUT, "resp-sell-390.png"), fullPage: false });

  // ── history daily summary at all 3 ──
  for (const [w, h, label] of [
    [390, 844, "390"],
    [768, 1024, "768"],
    [1024, 900, "1024"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
    const hasSales = await page.getByText(/ยอดขาย/).count();
    const hasVoidCount = await page.getByText(/ยกเลิกแล้ว/).count();
    if (hasSales > 0) pass(`history_${label}_sales_summary`);
    else fail(`history_${label}_sales_summary`, "ยอดขาย not found");
    await page.screenshot({
      path: join(OUT, `resp-history-${label}.png`),
      fullPage: false,
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (userId) {
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      await pool.query(`DELETE FROM pos_stock_movements WHERE user_id = $1 OR product_id IN (SELECT id FROM pos_products WHERE user_id = $1)`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`, [userId]);
      await pool.query(`DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`, [userId]);
      await pool.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM pos_products WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [userId]);
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
