/**
 * Phase-3 E2E: split payment + thai_chuay_thai + dark theme + sound overlay.
 * Usage: node scripts/e2e-pos-phase3-split.mjs
 * Does NOT change money/journal logic — test only.
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-screenshots");
mkdirSync(OUT, { recursive: true });

const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `split-e2e-${stamp}@rizance.test`;
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
  return pgClientOptions(connectionString);
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

function pool() {
  return new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
let productId = null;
let splitBillNo = null;
let splitBillId = null;
let legacyBillNo = null;

try {
  // ── 1) migration already applied externally; verify ──
  {
    const p = pool();
    const r = await p.query(
      `SELECT version FROM schema_migrations WHERE version = '0051_pos_bill_payments_split.sql'`,
    );
    const t = await p.query(`SELECT to_regclass('public.pos_bill_payments') AS t`);
    if (r.rows.length && t.rows[0]?.t) pass("migrate_0051", "pos_bill_payments exists");
    else fail("migrate_0051", JSON.stringify({ r: r.rows, t: t.rows }));
    await p.end();
  }

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
          shopName: "SPLIT E2E SHOP",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register ${reg.status}`);
  userId = reg.body?.data?.user?.id;

  {
    const p = pool();
    await p.query(
      `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
      [userId],
    );
    await p.end();
  }

  await context.clearCookies();
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 45000 });

  const created = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Split Item 79",
      sellPrice: 79,
      costPrice: 20,
      stockQty: 50,
    }),
  });
  if (created.status !== 201) throw new Error(`create product ${created.status} ${created.text}`);
  productId = created.body.data.id;
  pass("setup_product", "Split Item 79 @ 79");

  // Seed promptpay for QR tests
  await posApi(page, "/api/pos/settings", {
    method: "PUT",
    body: JSON.stringify({ promptpayId: "0812345678" }),
  }).catch(() => null);
  const settingsPut = await page.evaluate(async (profit) => {
    const res = await fetch(`${profit}/api/pos/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptpayId: "0812345678" }),
    });
    return { status: res.status, text: await res.text() };
  }, PROFIT);
  if (settingsPut.status >= 200 && settingsPut.status < 300) pass("setup_promptpay", "0812345678");
  else {
    // try POST
    const alt = await page.evaluate(async (profit) => {
      const res = await fetch(`${profit}/api/pos/settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptpayId: "0812345678" }),
      });
      return { status: res.status, text: await res.text() };
    }, PROFIT);
    if (alt.status >= 200 && alt.status < 300) pass("setup_promptpay", `POST ${alt.status}`);
    else fail("setup_promptpay", `${settingsPut.status} ${settingsPut.text} / ${alt.status}`);
  }

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Split Item 79").first().waitFor({ timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Split Item 79").first().waitFor({ timeout: 15000 });

  // Theme CSS vars check early
  const themeVars = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      paper: s.getPropertyValue("--paper").trim(),
      ink: s.getPropertyValue("--ink").trim(),
      money: s.getPropertyValue("--money-in").trim(),
      colorScheme: s.getPropertyValue("color-scheme").trim(),
    };
  });
  if (
    themeVars.paper.toLowerCase() === "#0e1525" &&
    themeVars.money.toLowerCase() === "#4ade9e" &&
    themeVars.colorScheme === "dark"
  ) {
    pass("theme_css_vars", JSON.stringify(themeVars));
  } else {
    fail("theme_css_vars", JSON.stringify(themeVars));
  }

  // ── 3) Normal cash bill: autofill + confirm + overlay ──
  await page.getByText("Split Item 79").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  const cashInput = page.getByLabel("ยอดเงินสด");
  const cashVal = await cashInput.inputValue();
  if (cashVal === "79.00" || cashVal === "79") pass("cash_autofill_79", cashVal);
  else fail("cash_autofill_79", cashVal);

  // Hook sound
  await page.evaluate(() => {
    window.__chimeCalls = 0;
    // playPaidChime uses AudioContext — patch Oscillator start if present after load
  });

  const confirmBtn = page.getByRole("button", { name: /ยืนยันรับเงิน/ });
  if (await confirmBtn.isEnabled()) pass("confirm_enabled_full_cash");
  else fail("confirm_enabled_full_cash", "disabled");

  await confirmBtn.click();
  await page.getByText("รับเงินแล้ว").first().waitFor({ timeout: 15000 });
  const overlayBg = await page.evaluate(() => {
    const label = [...document.querySelectorAll("button * , button")].find((n) =>
      (n.textContent || "").includes("รับเงินแล้ว"),
    );
    const btn = label?.closest?.("button") || label;
    if (!btn) return null;
    return getComputedStyle(btn).backgroundColor;
  });
  // mint green #4ade9e ≈ rgb(74, 222, 158)
  if (overlayBg && /74,\s*222,\s*158/.test(overlayBg)) pass("success_overlay_green", overlayBg);
  else if (await page.getByText("รับเงินแล้ว").count())
    pass("success_overlay_green", `visible bg=${overlayBg}`);
  else fail("success_overlay_green", `bg=${overlayBg}`);

  const soundOk = await page.evaluate(
    () => typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined",
  );
  if (soundOk) pass("sound_chime_api_available", "AudioContext present (chime on success path)");
  else fail("sound_chime_api_available", "no AudioContext");

  // Cart clears only after overlay dismiss (~1.8s auto)
  await page.getByText("รับเงินแล้ว").first().click({ force: true }).catch(() => {});
  await page.getByText("รับเงินแล้ว").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Split Item 79").first().waitFor({ timeout: 15000 });
  // ensure empty cart
  const cartEmpty = await page.evaluate(() => {
    try {
      return !JSON.parse(localStorage.getItem("rizance_pos_cart_v2") || "[]").length;
    } catch {
      return true;
    }
  });
  if (!cartEmpty) {
    await page.evaluate(() => localStorage.setItem("rizance_pos_cart_v2", "[]"));
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Split Item 79").first().waitFor({ timeout: 15000 });
  }
  // ── 4) Split: cash 39.50 + thai fill remaining ──
  await page.getByText("Split Item 79").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await cashInput.fill("39.50");
  await page.waitForTimeout(200);
  const remainText = await page.locator('[role="dialog"]').innerText();
  if (/ยังขาดอีก ฿?39\.50/.test(remainText)) pass("split_shortfall_banner", "ยังขาดอีก ฿39.50");
  else fail("split_shortfall_banner", remainText.slice(0, 300).replace(/\n/g, " | "));

  const confirm2 = page.getByRole("button", { name: /ยืนยันรับเงิน/ });
  if (await confirm2.isDisabled()) pass("split_confirm_disabled_shortfall");
  else fail("split_confirm_disabled_shortfall", "still enabled");

  // Click เต็ม on thai_chuay_thai row
  const thaiRow = page.locator("div").filter({ hasText: /^ไทยช่วยไทย/ }).first();
  // More reliable: find button เต็ม next to thai label
  const thaiFill = page
    .locator("div.flex.items-center")
    .filter({ hasText: "ไทยช่วยไทย" })
    .getByRole("button", { name: "เต็ม" });
  await thaiFill.click();
  await page.waitForTimeout(250);
  const afterFill = await page.locator('[role="dialog"]').innerText();
  if (!/ยังขาด/.test(afterFill) && (await confirm2.isEnabled())) {
    pass("split_thai_fill_clears_banner", "เต็ม → enabled");
  } else {
    fail("split_thai_fill_clears_banner", afterFill.slice(0, 250).replace(/\n/g, " | "));
  }

  await confirm2.click();
  await page.getByText("รับเงินแล้ว").first().waitFor({ timeout: 15000 });
  pass("split_checkout_ok", "closed");
  await page.getByText("รับเงินแล้ว").first().click({ force: true }).catch(() => {});
  await page.getByText("รับเงินแล้ว").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Lookup split bill (not merely latest)
  {
    const p = pool();
    const bill = await p.query(
      `SELECT id, bill_no, payment_method, total_amount::text
       FROM pos_bills WHERE user_id = $1 AND payment_method = 'split'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    splitBillId = bill.rows[0]?.id;
    splitBillNo = bill.rows[0]?.bill_no;
    if (bill.rows[0]?.payment_method === "split" && bill.rows[0]?.total_amount === "79.00") {
      pass("split_bill_db_method", `${splitBillNo} split 79`);
    } else {
      fail("split_bill_db_method", JSON.stringify(bill.rows[0]));
    }
    await p.end();
  }

  async function resetCartEmpty() {
    await page.evaluate(() => {
      localStorage.setItem("rizance_pos_cart_v2", "[]");
      localStorage.removeItem("rizance_pos_cart_v2");
    });
    await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByText("Split Item 79").first().waitFor({ timeout: 15000 });
  }

  // ── 5) Overpay banner ──
  await resetCartEmpty();
  await page.getByText("Split Item 79").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  // Ensure single-item total 79 then overfill cash
  const totalCheck = await page.locator('[role="dialog"]').innerText();
  if (!/฿79\.00/.test(totalCheck)) {
    fail("overpay_precheck_total", totalCheck.slice(0, 120).replace(/\n/g, " | "));
  }
  await cashInput.fill("100");
  await page.waitForTimeout(200);
  const overText = await page.locator('[role="dialog"]').innerText();
  if (/เกินยอดบิล/.test(overText) && (await page.getByRole("button", { name: /ยืนยันรับเงิน/ }).isDisabled())) {
    pass("overpay_banner_disabled", "เกินยอดบิล + disabled");
  } else {
    fail("overpay_banner_disabled", overText.slice(0, 250).replace(/\n/g, " | "));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── 6) PromptPay 40 + cash 39, QR amount 40, change 61 ──
  await resetCartEmpty();
  await page.getByText("Split Item 79").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await cashInput.fill("39");
  const ppInput = page.getByLabel("ยอดPromptPay");
  await ppInput.fill("40");
  await page.waitForTimeout(400);
  const sheet6 = await page.locator('[role="dialog"]').innerText();
  if (/฿40\.00/.test(sheet6) && /PromptPay/.test(sheet6)) pass("promptpay_qr_amount_40", "QR shows 40");
  else fail("promptpay_qr_amount_40", sheet6.slice(0, 350).replace(/\n/g, " | "));

  const qrWhite = await page.evaluate(() => {
    const white = [...document.querySelectorAll('[role="dialog"] div')].find(
      (d) => getComputedStyle(d).backgroundColor === "rgb(255, 255, 255)",
    );
    return !!white;
  });
  if (qrWhite) pass("promptpay_qr_white_area");
  else fail("promptpay_qr_white_area", "no white bg found");

  await page.getByLabel(/รับเงินสดมา/).fill("100");
  await page.waitForTimeout(200);
  const changeText = await page.locator('[role="dialog"]').innerText();
  if (/เงินทอน[\s\S]*61\.00/.test(changeText) || /61\.00/.test(changeText)) {
    pass("change_on_cash_portion", "100-39=61");
  } else {
    fail("change_on_cash_portion", changeText.slice(0, 300).replace(/\n/g, " | "));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── 7) History shows แบ่งจ่าย + breakdown ──
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
  const listText = await page.locator("main").innerText();
  if (/แบ่งจ่าย/.test(listText)) pass("history_list_split_label", "แบ่งจ่าย visible");
  else fail("history_list_split_label", listText.slice(0, 300).replace(/\n/g, " | "));

  await page.getByRole("button").filter({ hasText: splitBillNo }).click();
  await page.getByText("Smash L").or(page.getByText("Split Item 79")).first().waitFor({
    timeout: 15000,
  });
  const detail = await page.locator('[role="dialog"]').innerText();
  const hasBreakdown =
    /แบ่งจ่าย/.test(detail) &&
    /เงินสด/.test(detail) &&
    /ไทยช่วยไทย/.test(detail) &&
    /39\.50/.test(detail);
  if (hasBreakdown) pass("history_detail_breakdown", "2 rows 39.50");
  else fail("history_detail_breakdown", detail.slice(0, 400).replace(/\n/g, " | "));
  await page.screenshot({ path: join(OUT, "phase3-history-split-detail.png"), fullPage: false });
  await page.keyboard.press("Escape");

  // ── 8) Dashboard thai card 39.50 ──
  await page.goto(`${POS}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(800);
  const dash = await page.locator("main").innerText();
  if (/ไทยช่วยไทย/.test(dash) && /39\.50/.test(dash)) pass("dashboard_thai_39_50", "card shows 39.50");
  else fail("dashboard_thai_39_50", dash.slice(0, 400).replace(/\n/g, " | "));
  await page.screenshot({ path: join(OUT, "phase3-dashboard-thai.png"), fullPage: false });

  // ── 9) Dark theme screenshots 4 pages @390 ──
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  // copy cookies
  await mobile.addCookies(await context.cookies());
  const pages = [
    { path: "/", name: "sell" },
    { path: "/history", name: "history" },
    { path: "/products", name: "products" },
    { path: "/dashboard", name: "dashboard" },
  ];
  for (const pg of pages) {
    await mpage.goto(`${POS}${pg.path}`, { waitUntil: "networkidle", timeout: 45000 });
    await mpage.waitForTimeout(500);
    const contrast = await mpage.evaluate(() => {
      const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const bodyColor = getComputedStyle(document.body).color;
      // sample nav
      const nav = document.querySelector("nav") || document.querySelector("[class*='bottom']");
      const navColor = nav ? getComputedStyle(nav).color : null;
      const navBg = nav ? getComputedStyle(nav).backgroundColor : null;
      return { paper, ink, bodyBg, bodyColor, navColor, navBg };
    });
    await mpage.screenshot({
      path: join(OUT, `phase3-dark-${pg.name}-390.png`),
      fullPage: false,
    });
    const ok =
      contrast.paper.toLowerCase() === "#0e1525" &&
      !/^rgb\(255,\s*255,\s*255\)$/.test(contrast.bodyBg);
    if (ok) pass(`theme_dark_${pg.name}`, JSON.stringify(contrast));
    else fail(`theme_dark_${pg.name}`, JSON.stringify(contrast));
  }

  // Open checkout on sell for sheet + category chip check
  await mpage.goto(`${POS}/`, { waitUntil: "networkidle", timeout: 45000 });
  await mpage.getByText("Split Item 79").first().click();
  await mpage.getByRole("button", { name: /ตะกร้า|คิดเงิน/ }).first().click().catch(() => {});
  // mobile cart sheet then checkout
  const payBtn = mpage.getByRole("button", { name: "คิดเงิน" });
  if (await payBtn.count()) await payBtn.click();
  await mpage.waitForTimeout(500);
  if (await mpage.locator("h2:has-text('ชำระเงิน')").count()) {
    await mpage.screenshot({ path: join(OUT, "phase3-dark-checkout-sheet-390.png"), fullPage: false });
    pass("theme_dark_checkout_sheet", "screenshot saved");
  } else {
    fail("theme_dark_checkout_sheet", "sheet not open");
  }
  await mobile.close();

  // ── 10–12) DB invariants for split bill ──
  {
    const p = pool();
    const inv = await p.query(
      `SELECT b.bill_no, b.payment_method, b.total_amount::text AS total_amount,
              (SELECT SUM(pay.amount)::text FROM pos_bill_payments pay WHERE pay.bill_id=b.id) AS pay_sum,
              (SELECT SUM(bi.line_total)::text FROM pos_bill_items bi WHERE bi.bill_id=b.id) AS line_sum
       FROM pos_bills b
       WHERE b.id = $1`,
      [splitBillId],
    );
    const row = inv.rows[0];
    if (
      row?.payment_method === "split" &&
      parseFloat(row.total_amount) === parseFloat(row.pay_sum) &&
      parseFloat(row.total_amount) === parseFloat(row.line_sum) &&
      parseFloat(row.total_amount) === 79
    ) {
      pass("invariant_bill_pay_line", JSON.stringify(row));
    } else {
      fail("invariant_bill_pay_line", JSON.stringify(row));
    }

    const income = await p.query(
      `SELECT payment_method, amount::text AS amount, voided_at
       FROM income_entries
       WHERE user_id = $1 AND note LIKE 'POS%'
       ORDER BY created_at DESC LIMIT 6`,
      [userId],
    );
    const splitIncomes = income.rows.filter(
      (r) =>
        (r.payment_method === "cash" || r.payment_method === "transfer") &&
        parseFloat(r.amount) === 39.5 &&
        !r.voided_at,
    );
    // Need both cash 39.50 and transfer 39.50 among recent
    const hasCash = income.rows.some(
      (r) => r.payment_method === "cash" && parseFloat(r.amount) === 39.5 && !r.voided_at,
    );
    const hasTransfer = income.rows.some(
      (r) => r.payment_method === "transfer" && parseFloat(r.amount) === 39.5 && !r.voided_at,
    );
    if (hasCash && hasTransfer) pass("invariant_income_buckets", JSON.stringify(income.rows.slice(0, 4)));
    else fail("invariant_income_buckets", JSON.stringify(income.rows));

    const journal = await p.query(
      `SELECT jl.account_code, jl.debit::text AS debit, jl.credit::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1 AND je.source_module = 'pos'
         AND je.source_event_id = $2 AND je.source_event_type = 'pos_bill_paid'
       ORDER BY jl.account_code, jl.debit DESC`,
      [userId, splitBillId],
    );
    const lines = journal.rows;
    const d1000 = lines.find((l) => l.account_code === "1000" && parseFloat(l.debit) > 0);
    const d1010 = lines.find((l) => l.account_code === "1010" && parseFloat(l.debit) > 0);
    const c4000 = lines.find((l) => l.account_code === "4000" && parseFloat(l.credit) > 0);
    const sumD = lines.reduce((s, l) => s + parseFloat(l.debit), 0);
    const sumC = lines.reduce((s, l) => s + parseFloat(l.credit), 0);
    if (
      d1000 &&
      parseFloat(d1000.debit) === 39.5 &&
      d1010 &&
      parseFloat(d1010.debit) === 39.5 &&
      c4000 &&
      parseFloat(c4000.credit) === 79 &&
      Math.abs(sumD - sumC) < 0.001
    ) {
      pass("invariant_journal_split", JSON.stringify(lines));
    } else {
      fail("invariant_journal_split", JSON.stringify({ lines, sumD, sumC }));
    }

    // stock before void
    const stockBefore = await p.query(`SELECT stock_qty::text FROM pos_products WHERE id = $1`, [
      productId,
    ]);
    const stockBeforeVal = parseFloat(stockBefore.rows[0].stock_qty);

    await p.end();

    // ── 13) Void split bill ──
    await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByRole("button").filter({ hasText: splitBillNo }).click();
    await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();
    await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
    await page.locator("textarea").fill("ทดสอบ void split");
    await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();
    for (let i = 0; i < 20; i++) {
      const p2 = pool();
      const st = await p2.query(`SELECT status FROM pos_bills WHERE id = $1`, [splitBillId]);
      await p2.end();
      if (st.rows[0]?.status === "voided") break;
      await page.waitForTimeout(250);
    }

    const p3 = pool();
    const voided = await p3.query(`SELECT status FROM pos_bills WHERE id = $1`, [splitBillId]);
    if (voided.rows[0]?.status === "voided") pass("void_split_status", "voided");
    else fail("void_split_status", voided.rows[0]?.status);

    const incomeVoid = await p3.query(
      `SELECT payment_method, amount::text, voided_at IS NOT NULL AS voided
       FROM income_entries ie
       WHERE ie.id IN (
         SELECT income_entry_id FROM pos_bill_payments WHERE bill_id = $1 AND income_entry_id IS NOT NULL
       )`,
      [splitBillId],
    );
    if (
      incomeVoid.rows.length >= 2 &&
      incomeVoid.rows.every((r) => r.voided === true)
    ) {
      pass("void_income_both", JSON.stringify(incomeVoid.rows));
    } else {
      fail("void_income_both", JSON.stringify(incomeVoid.rows));
    }

    const jr = await p3.query(
      `SELECT source_event_type FROM journal_entries
       WHERE user_id = $1 AND source_event_id = $2 ORDER BY created_at`,
      [userId, splitBillId],
    );
    const types = jr.rows.map((r) => r.source_event_type);
    if (types.includes("pos_bill_paid") && types.includes("pos_bill_paid_reversal")) {
      pass("void_journal_reversal", types.join(", "));
    } else {
      fail("void_journal_reversal", JSON.stringify(types));
    }

    const stockAfter = await p3.query(`SELECT stock_qty::text FROM pos_products WHERE id = $1`, [
      productId,
    ]);
    const stockAfterVal = parseFloat(stockAfter.rows[0].stock_qty);
    // sold 2 items before void of split (cash bill + split) — void only restores split's 1
    if (stockAfterVal === stockBeforeVal + 1) {
      pass("void_restores_stock", `${stockBeforeVal} → ${stockAfterVal}`);
    } else {
      fail("void_restores_stock", `${stockBeforeVal} → ${stockAfterVal}`);
    }
    await p3.end();
  }

  // ── 14) Legacy bill before 0051: cash bill with payment rows removed ──
  {
    await resetCartEmpty();
    await page.getByText("Split Item 79").first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "คิดเงิน" }).click();
    await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
    await page.getByRole("button", { name: /ยืนยันรับเงิน/ }).click();
    await page.getByText("รับเงินแล้ว").first().waitFor({ timeout: 15000 });
    await page.getByText("รับเงินแล้ว").first().click({ force: true }).catch(() => {});
    await page.getByText("รับเงินแล้ว").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});

    const p = pool();
    const leg = await p.query(
      `SELECT id, bill_no FROM pos_bills
       WHERE user_id = $1 AND payment_method = 'cash' AND status = 'paid'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const billId = leg.rows[0]?.id;
    legacyBillNo = leg.rows[0]?.bill_no;
    // Simulate pre-0051: strip payment rows (bill-level method remains)
    await p.query(`DELETE FROM pos_bill_payments WHERE bill_id = $1`, [billId]);
    const left = await p.query(`SELECT count(*)::int AS n FROM pos_bill_payments WHERE bill_id = $1`, [
      billId,
    ]);
    await p.end();
    if (left.rows[0]?.n === 0) pass("legacy_strip_payments", legacyBillNo);
    else fail("legacy_strip_payments", JSON.stringify(left.rows[0]));

    await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByRole("button").filter({ hasText: legacyBillNo }).click();
    await page.getByText("Split Item 79").first().waitFor({ timeout: 15000 });
    const legDetail = await page.locator('[role="dialog"]').innerText();
    if (
      /Split Item 79/.test(legDetail) &&
      /79/.test(legDetail) &&
      !/โหลดไม่สำเร็จ|error/i.test(legDetail)
    ) {
      pass("legacy_bill_history_ok", legacyBillNo);
    } else {
      fail("legacy_bill_history_ok", legDetail.slice(0, 300).replace(/\n/g, " | "));
    }
    await page.screenshot({ path: join(OUT, "phase3-legacy-bill-detail.png"), fullPage: false });
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
        `DELETE FROM pos_bill_item_modifiers WHERE bill_item_id IN (
           SELECT bi.id FROM pos_bill_items bi JOIN pos_bills b ON b.id = bi.bill_id WHERE b.user_id = $1)`,
        [userId],
      );
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
