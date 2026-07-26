/**
 * Viewport-only Sheet overlay screenshot @ 390×844 (fullPage: false mandatory).
 * Usage: node scripts/capture-sheet-viewport-390.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-screenshots");
const OUT_FILE = join(OUT, "history-05-sheet-viewport-390.png");
mkdirSync(OUT, { recursive: true });

const PROFIT = "https://rizance.app";
const POS = "https://pos.rizance.app";
const stamp = Date.now();
const email = `sheet-vp-${stamp}@rizance.test`;
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
    { profit: PROFIT, posOrigin: POS, path, init: { method: init.method, body: init.body } },
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let userId = null;
let productId = null;
let billId = null;

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
          shopName: "Sheet Viewport Shop",
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
  await page.goto(`${PROFIT}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30000 });

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  const prod = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({ name: "Viewport Item", sellPrice: 120, costPrice: 30, stockQty: 5 }),
  });
  if (prod.status !== 201) throw new Error(`product ${prod.status}`);
  productId = prod.body?.data?.id;

  const bill = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({ items: [{ productId, qty: 1 }], paymentMethod: "cash" }),
  });
  if (bill.status !== 201) throw new Error(`bill ${bill.status}`);
  billId = bill.body?.data?.bill?.id;
  const billNo = bill.body?.data?.bill?.billNo;
  console.log("bill", billNo);

  // Step 1: viewport exactly 390×844
  await page.setViewportSize({ width: 390, height: 844 });

  // Step 2: /history
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });

  // Step 3: click bill
  await page.getByRole("button").filter({ hasText: billNo }).click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByText("ยอดรวม").waitFor({ timeout: 15000 });

  // Inspect backdrop in live browser before screenshot
  const inspect = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: "no dialog" };
    const backdrop = dialog.querySelector('button[aria-label="ปิด"]');
    const panel = dialog.querySelector(".relative.z-10");
    const csDialog = getComputedStyle(dialog);
    const csBackdrop = backdrop ? getComputedStyle(backdrop) : null;
    const csPanel = panel ? getComputedStyle(panel) : null;
    const root = getComputedStyle(document.documentElement);
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollY: window.scrollY,
      dialog: {
        position: csDialog.position,
        zIndex: csDialog.zIndex,
        display: csDialog.display,
        className: dialog.className,
      },
      backdrop: backdrop
        ? {
            exists: true,
            position: csBackdrop.position,
            zIndex: csBackdrop.zIndex,
            backgroundColor: csBackdrop.backgroundColor,
            opacity: csBackdrop.opacity,
            className: backdrop.className,
            rect: backdrop.getBoundingClientRect(),
          }
        : { exists: false },
      panel: panel
        ? {
            position: csPanel.position,
            zIndex: csPanel.zIndex,
            rect: panel.getBoundingClientRect(),
          }
        : null,
      cssVars: {
        ink: root.getPropertyValue("--color-ink").trim() || "(unset)",
      },
      historyH1Visible: !!document.querySelector("h1"),
    };
  });
  console.log("INSPECT:", JSON.stringify(inspect, null, 2));

  // Step 4: viewport-only screenshot, no scroll
  await page.screenshot({ path: OUT_FILE, fullPage: false });
  console.log("saved", OUT_FILE);
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
