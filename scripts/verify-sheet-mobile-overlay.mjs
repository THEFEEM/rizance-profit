/**
 * Verify Sheet overlay behavior on mobile (390×844) — viewport screenshot + backdrop tap.
 * Usage: node scripts/verify-sheet-mobile-overlay.mjs
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
const stamp = Date.now();
const email = `sheet-verify-${stamp}@rizance.test`;
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
    {
      profit: PROFIT,
      posOrigin: POS,
      path,
      init: { method: init.method, body: init.body, headers: init.headers },
    },
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let userId = null;
let productId = null;
let billId = null;
let billNo = null;

const checks = [];

function pass(name, detail = "") {
  checks.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}

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
          shopName: "Sheet Verify Shop",
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
    body: JSON.stringify({ name: "Verify Item", sellPrice: 99, costPrice: 10, stockQty: 5 }),
  });
  if (prod.status !== 201) throw new Error(`product ${prod.status}`);
  productId = prod.body?.data?.id;

  const bill = await posApi(page, "/api/pos/bills", {
    method: "POST",
    body: JSON.stringify({ items: [{ productId, qty: 1 }], paymentMethod: "cash" }),
  });
  if (bill.status !== 201) throw new Error(`bill ${bill.status}`);
  billId = bill.body?.data?.bill?.id;
  billNo = bill.body?.data?.bill?.billNo;
  pass("setup_bill", billNo);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });

  const historyHeading = await page.locator("h1:has-text('ประวัติบิล')").boundingBox();
  if (historyHeading) pass("history_visible_before_open", `y=${historyHeading.y}`);
  else fail("history_visible_before_open", "no bounding box");

  const billRow = page.getByRole("button").filter({ hasText: billNo });
  await billRow.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByText("ยอดรวม").waitFor({ timeout: 15000 });

  const domCheck = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: "no dialog" };
    const dialogStyle = getComputedStyle(dialog);
    const backdrop = dialog.querySelector('button[aria-label="ปิด"]');
    const panel = dialog.querySelector(".relative.z-10");
    const historyH1 = document.querySelector("h1");
    const historyStillInDom = !!historyH1 && historyH1.textContent?.includes("ประวัติบิล");
    const historyRect = historyH1?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
    return {
      dialogPosition: dialogStyle.position,
      dialogZIndex: dialogStyle.zIndex,
      backdropExists: !!backdrop,
      backdropPosition: backdropStyle?.position,
      backdropBg: backdropStyle?.backgroundColor,
      panelExists: !!panel,
      panelBottom: panelRect?.bottom,
      panelTop: panelRect?.top,
      viewportHeight: window.innerHeight,
      historyStillInDom,
      historyTop: historyRect?.top,
      bodyOverflow: document.body.style.overflow,
    };
  });

  console.log("DOM check:", JSON.stringify(domCheck, null, 2));

  if (domCheck.dialogPosition === "fixed") pass("dialog_fixed_position");
  else fail("dialog_fixed_position", domCheck.dialogPosition ?? domCheck.error);

  if (domCheck.backdropExists) pass("backdrop_present");
  else fail("backdrop_present", "missing");

  if (domCheck.historyStillInDom) pass("history_dom_persists_behind_sheet");
  else fail("history_dom_persists_behind_sheet", "h1 gone");

  if (domCheck.panelTop != null && domCheck.panelTop > 100) {
    pass("panel_floats_not_top_aligned", `panelTop=${domCheck.panelTop}`);
  } else {
    fail("panel_floats_not_top_aligned", `panelTop=${domCheck.panelTop}`);
  }

  if (domCheck.bodyOverflow === "hidden") pass("body_scroll_locked");
  else fail("body_scroll_locked", domCheck.bodyOverflow);

  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(OUT, "sheet-mobile-390-viewport-verify.png"),
    fullPage: false,
  });
  pass("viewport_screenshot", "sheet-mobile-390-viewport-verify.png");

  await page.locator('[role="dialog"] button[aria-label="ปิด"]').first().click({ force: true });
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 5000 });
  const dialogGone = (await page.locator('[role="dialog"]').count()) === 0;
  if (dialogGone) pass("backdrop_tap_closes_sheet");
  else fail("backdrop_tap_closes_sheet", "dialog still open");

  await billRow.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  const reopened = (await page.locator('[role="dialog"]').count()) === 1;
  if (reopened) pass("sheet_reopens_on_bill_click");
  else fail("sheet_reopens_on_bill_click", "dialog missing after re-click");

  console.log(`\nOUT=${OUT}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.log(`\n${failed.length} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${checks.length} checks passed — Sheet overlays correctly on mobile`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
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
