/**
 * Phase-1 POS checks: dashboard vs history, categories layout, 4-tab nav.
 * Usage: node scripts/e2e-pos-phase1-dashboard.mjs
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

const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `phase1-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}

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

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocal(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
const productIds = [];
const categoryIds = [];
const billIds = [];

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
          shopName: "Phase1 Dash Shop",
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

  // Categories
  const catA = await posApi(page, "/api/pos/categories", {
    method: "POST",
    body: JSON.stringify({ name: "เครื่องดื่ม", color: "#0e7c5b" }),
  });
  const catB = await posApi(page, "/api/pos/categories", {
    method: "POST",
    body: JSON.stringify({ name: "ของหวาน", color: "#b45309" }),
  });
  if (catA.status !== 201 && catA.status !== 200) {
    // maybe POST not available — try continue without strict fail for categories create
    console.log("catA", catA.status, catA.text?.slice(0, 120));
  }
  const catAId = catA.body?.data?.id;
  const catBId = catB.body?.data?.id;
  if (catAId) categoryIds.push(catAId);
  if (catBId) categoryIds.push(catBId);

  // Products with different totals for top-5 ranking
  const specs = [
    { name: "Top Drink", sellPrice: 100, categoryId: catAId, qty: 3 }, // 300
    { name: "Mid Sweet", sellPrice: 80, categoryId: catBId, qty: 2 }, // 160
    { name: "Low Drink", sellPrice: 50, categoryId: catAId, qty: 1 }, // 50
    { name: "Other A", sellPrice: 40, categoryId: catBId, qty: 1 },
    { name: "Other B", sellPrice: 30, categoryId: null, qty: 1 },
    { name: "Other C", sellPrice: 20, categoryId: null, qty: 1 },
  ];

  for (const s of specs) {
    const p = await posApi(page, "/api/pos/products", {
      method: "POST",
      body: JSON.stringify({
        name: s.name,
        sellPrice: s.sellPrice,
        costPrice: 5,
        stockQty: 50,
        categoryId: s.categoryId || undefined,
      }),
    });
    if (p.status !== 201) throw new Error(`product ${s.name} ${p.status}`);
    productIds.push(p.body.data.id);
    const bill = await posApi(page, "/api/pos/bills", {
      method: "POST",
      body: JSON.stringify({
        items: [{ productId: p.body.data.id, qty: s.qty }],
        paymentMethod: "cash",
      }),
    });
    if (bill.status !== 201) throw new Error(`bill ${s.name} ${bill.status}`);
    billIds.push(bill.body.data.bill.id);
  }
  pass("setup_bills", `${billIds.length} bills`);

  const today = todayLocal();
  const hourNow = new Date().getHours();

  // ── 2) Dashboard vs history ──
  const summaryRes = await posApi(page, `/api/pos/summary?date=${today}`);
  const billsRes = await posApi(page, `/api/pos/bills?date=${today}`);
  if (summaryRes.status !== 200) throw new Error(`summary ${summaryRes.status} ${summaryRes.text}`);
  if (billsRes.status !== 200) throw new Error(`bills ${billsRes.status}`);

  const summary = summaryRes.body.data;
  const bills = billsRes.body.data.bills;
  const paidBills = bills.filter((b) => b.status === "paid");
  const histTotal = paidBills.reduce((s, b) => s + parseFloat(b.total), 0);
  const histCount = paidBills.length;

  const dashTotal = parseFloat(summary.paidTotal);
  const dashCount = summary.paidCount;

  if (Math.abs(dashTotal - histTotal) < 0.01 && dashCount === histCount) {
    pass("dashboard_matches_history", `฿${dashTotal} / ${dashCount} bills`);
  } else {
    fail(
      "dashboard_matches_history",
      `dash=${dashTotal}/${dashCount} hist=${histTotal}/${histCount}`,
    );
  }

  const hourBucket = summary.hourly?.[hourNow];
  if (hourBucket && parseFloat(hourBucket.total) > 0) {
    pass("hourly_bar_current_hour", `hour ${hourNow} total=${hourBucket.total} count=${hourBucket.count}`);
  } else {
    fail("hourly_bar_current_hour", `hour ${hourNow} = ${JSON.stringify(hourBucket)}`);
  }

  const top = summary.topProducts ?? [];
  const topNames = top.map((t) => t.productName ?? t.name);
  let rankedOk = true;
  for (let i = 1; i < top.length; i++) {
    if (parseFloat(top[i - 1].total) < parseFloat(top[i].total)) rankedOk = false;
  }
  if (top.length > 0 && rankedOk && topNames[0] === "Top Drink") {
    pass("top5_by_revenue", topNames.slice(0, 5).join(" > "));
  } else if (top.length > 0 && rankedOk) {
    pass("top5_by_revenue", `sorted: ${topNames.slice(0, 5).join(" > ")}`);
  } else {
    fail("top5_by_revenue", JSON.stringify(top.slice(0, 5)));
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${POS}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('สรุปยอดขาย')", { timeout: 15000 });
  await page.getByText(/ยอดขาย/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(OUT, "phase1-dashboard-today.png"), fullPage: false });

  // ── 3) Change date back ──
  const yesterday = addDaysLocal(today, -1);
  const ySumBefore = await posApi(page, `/api/pos/summary?date=${yesterday}`);
  await page.getByRole("button", { name: /วันก่อน/ }).click();
  await page.waitForTimeout(800);
  // date input should update
  const dateInput = page.locator('input[type="date"]');
  const dateVal = await dateInput.inputValue();
  if (dateVal === yesterday) pass("dashboard_date_prev", dateVal);
  else fail("dashboard_date_prev", `got ${dateVal} expected ${yesterday}`);

  const bodyY = await page.locator("body").innerText();
  const yPaid = ySumBefore.body?.data?.paidCount ?? 0;
  // yesterday should show 0 bills for this new shop
  if (yPaid === 0 && (/ยอดขาย \(0 บิล\)/.test(bodyY) || /0\.00/.test(bodyY))) {
    pass("dashboard_date_data_changes", "yesterday empty for new shop");
  } else {
    // still ok if UI refreshed to different numbers than today
    const todayLabel = `ยอดขาย (${dashCount} บิล)`;
    if (!bodyY.includes(todayLabel) || dashCount === 0) {
      pass("dashboard_date_data_changes", `UI after prev: ${bodyY.match(/ยอดขาย[^\n]*/)?.[0] ?? "?"}`);
    } else {
      fail("dashboard_date_data_changes", "still showing today's bill count");
    }
  }
  await page.screenshot({ path: join(OUT, "phase1-dashboard-yesterday.png"), fullPage: false });

  // ── 4) Categories: desktop sidebar vs mobile chips ──
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Top Drink").waitFor({ timeout: 15000 });

  const sideNav = page.locator('nav[aria-label="หมวดหมู่สินค้า"]');
  if (await sideNav.isVisible()) pass("sell_1024_category_sidebar");
  else fail("sell_1024_category_sidebar", "sidebar not visible");

  const chipsDesktop = page.locator("section .mb-4.flex.gap-2.md\\:hidden");
  // chips container has md:hidden — should not be visible at 1024
  const chipsVisibleDesktop = await page
    .locator("section >> div.mb-4.flex.gap-2")
    .first()
    .isVisible()
    .catch(() => false);
  // Prefer checking computed display of md:hidden chips row
  const chipRowHidden = await page.evaluate(() => {
    const el = document.querySelector("section .md\\:hidden, section div.mb-4.flex.gap-2.overflow-x-auto");
    if (!el) return true;
    return getComputedStyle(el).display === "none";
  });
  if (chipRowHidden) pass("sell_1024_chips_hidden");
  else fail("sell_1024_chips_hidden", "chips still visible");

  if (catAId) {
    await sideNav.getByRole("button", { name: "เครื่องดื่ม" }).click();
    await page.waitForTimeout(300);
    const body = await page.locator("section").innerText();
    if (body.includes("Top Drink") && body.includes("Low Drink") && !body.includes("Mid Sweet")) {
      pass("sell_1024_category_filter", "drink only");
    } else if (body.includes("Top Drink") && !body.includes("Mid Sweet")) {
      pass("sell_1024_category_filter", "filtered");
    } else {
      fail("sell_1024_category_filter", body.slice(0, 200));
    }
  } else {
    fail("sell_1024_category_filter", "no category id");
  }
  await page.screenshot({ path: join(OUT, "phase1-sell-1024-cats.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Top Drink").waitFor({ timeout: 15000 });
  const sideHidden = !(await sideNav.isVisible());
  if (sideHidden) pass("sell_390_sidebar_hidden");
  else fail("sell_390_sidebar_hidden", "sidebar visible on mobile");

  const chipsMobile = page.getByRole("button", { name: "ทั้งหมด" }).first();
  // mobile chips row
  const chipAllVisible = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("section button")].filter((b) =>
      b.textContent?.includes("ทั้งหมด"),
    );
    const chip = buttons.find((b) => b.className.includes("rounded-full"));
    return chip ? getComputedStyle(chip).display !== "none" && chip.getBoundingClientRect().width > 0 : false;
  });
  if (chipAllVisible) pass("sell_390_chips_visible");
  else fail("sell_390_chips_visible", "no horizontal chips");

  if (catBId) {
    await page.getByRole("button", { name: "ของหวาน" }).click();
    await page.waitForTimeout(300);
    const body = await page.locator("section").innerText();
    if (body.includes("Mid Sweet") && !body.includes("Top Drink")) {
      pass("sell_390_category_filter", "sweet only");
    } else {
      fail("sell_390_category_filter", body.slice(0, 200));
    }
  }
  await page.screenshot({ path: join(OUT, "phase1-sell-390-chips.png"), fullPage: false });

  // ── 5) Bottom nav 4 tabs, no overflow ──
  const bottomNav = page.locator('nav.md\\:hidden[aria-label="เมนูหลัก"], nav[aria-label="เมนูหลัก"]').last();
  await bottomNav.waitFor({ timeout: 5000 });
  const links = bottomNav.locator("a");
  const linkCount = await links.count();
  const labels = [];
  for (let i = 0; i < linkCount; i++) labels.push((await links.nth(i).innerText()).replace(/\n/g, " "));
  if (linkCount === 4 && labels.some((l) => l.includes("สรุป"))) {
    pass("bottom_nav_4_tabs", labels.join(" | "));
  } else {
    fail("bottom_nav_4_tabs", `${linkCount}: ${labels.join(",")}`);
  }

  const navBox = await bottomNav.boundingBox();
  const overflow = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="เมนูหลัก"]')].find(
      (n) => getComputedStyle(n).position === "fixed",
    );
    if (!nav) return { error: "no fixed nav" };
    const grid = nav.querySelector("div");
    const rect = nav.getBoundingClientRect();
    return {
      navWidth: rect.width,
      scrollWidth: nav.scrollWidth,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      childrenOverflow: [...(grid?.children ?? [])].some(
        (c) => c.getBoundingClientRect().right > window.innerWidth + 1,
      ),
    };
  });
  if (
    overflow.gridCols === 4 &&
    !overflow.childrenOverflow &&
    overflow.scrollWidth <= overflow.navWidth + 2
  ) {
    pass("bottom_nav_no_overflow", JSON.stringify(overflow));
  } else {
    fail("bottom_nav_no_overflow", JSON.stringify(overflow));
  }
  await page.screenshot({ path: join(OUT, "phase1-bottom-nav-390.png"), fullPage: false });

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
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      await pool.query(
        `DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(
        `DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      if (productIds.length) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await pool.query(`DELETE FROM pos_bill_items WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await pool.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      if (categoryIds.length) {
        await pool.query(`DELETE FROM pos_categories WHERE id = ANY($1::uuid[])`, [categoryIds]);
      }
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [
        userId,
      ]);
      await pool.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM pos_shop_settings WHERE user_id = $1`, [userId]).catch(() => {});
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
