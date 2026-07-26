/**
 * Production browser E2E — POS auth (A/B) + history/void flow (C).
 * Usage:
 *   node scripts/prod-pos-browser-e2e.mjs           # history/void only
 *   node scripts/prod-pos-browser-e2e.mjs --auth    # auth A/B + history/void
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "prod-history-void-e2e");
mkdirSync(OUT, { recursive: true });

const PROFIT = "https://rizance.app";
const POS = "https://pos.rizance.app";
const PROFIT_COM = "https://www.rizance.com";
const SESSION_API = `${PROFIT}/api/pos/session`;
const stamp = Date.now();
const emailA = `pos-browser-a-${stamp}@rizance.test`;
const emailB = `pos-browser-b-${stamp}@rizance.test`;
const emailHistory = `pos-history-${stamp}@rizance.test`;
const emailWww = `pos-www-${stamp}@rizance.test`;
const password = `Smoke${stamp}!`;
const productName = `E2E History ${stamp}`;
const voidReason = `ทดสอบ void production ${stamp}`;

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}

function attachSessionCapture(page) {
  const captured = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/pos/session")) return;
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "(unreadable)";
    }
    captured.push({
      url: res.url(),
      status: res.status(),
      acao: res.headers()["access-control-allow-origin"] ?? null,
      body: body.slice(0, 200),
    });
  });
  return captured;
}

function reportSession(captured, label) {
  const hits = captured.filter((c) => c.url.includes("/api/pos/session"));
  if (!hits.length) {
    fail(`${label}_pos_session_network`, "no /api/pos/session request captured");
    return;
  }
  for (const hit of hits) {
    console.log(`  [network] ${hit.url} status=${hit.status} acao=${hit.acao} body=${hit.body}`);
  }
  const ok = hits.find((h) => h.status === 200) ?? hits[hits.length - 1];
  if (ok.status === 200) pass(`${label}_pos_session_network`, `200 from ${ok.url}`);
  else fail(`${label}_pos_session_network`, `last status ${ok.status} (expected 200)`);
}

async function registerAccount(page, email, mode = "regular") {
  return page.evaluate(
    async ({ email, password, mode }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, shopName: "POS E2E", mode }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password, mode },
  );
}

async function deleteUserByEmail(email) {
  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  try {
    await pool.query(`DELETE FROM users WHERE email = $1`, [email]);
  } finally {
    await pool.end();
  }
}

async function assertPosJournalAndTrialBalance(userId, billId, label) {
  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  try {
    const journals = await pool.query(
      `SELECT id, source_module, source_event_type, source_event_id::text
       FROM journal_entries
       WHERE user_id = $1 AND source_module = 'pos' AND source_event_id = $2
       ORDER BY created_at`,
      [userId, billId],
    );
    const paid = journals.rows.find((r) => r.source_event_type === "pos_bill_paid");
    if (paid) pass(`${label}_journal_pos_bill_paid`, paid.id);
    else fail(`${label}_journal_pos_bill_paid`, `rows=${journals.rows.length}`);

    const trial = await pool.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS sum_balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1`,
      [userId],
    );
    const sum = Number(trial.rows[0]?.sum_balance ?? "NaN");
    if (Math.abs(sum) < 0.001) pass(`${label}_trial_balance_sum0`, String(sum));
    else fail(`${label}_trial_balance_sum0`, String(sum));
  } finally {
    await pool.end();
  }
}

async function uiLogin(page, email) {
  await page.goto(`${PROFIT}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30000 });
}

function isPosAuthenticated(text) {
  if (text.includes("กรุณาเข้าสู่ระบบ")) return false;
  if (text.includes("ไปหน้า Login")) return false;
  return (
    text.includes("ต้อง upgrade เป็น Business") ||
    text.includes("สินค้า") ||
    text.includes("POS E2E") ||
    text.includes("ประวัติบิล")
  );
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
  throw new Error("DATABASE_URL not found in .env.local");
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

/** POS API via browser cookie jar (www + pos origins). */
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
      let body = null;
      let text = "";
      try {
        text = await res.text();
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
      init: {
        method: init.method,
        body: init.body,
        headers: init.headers,
      },
    },
  );
}

async function setupBusinessUser(page) {
  await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
  const reg = await registerAccount(page, emailHistory, "regular");
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register failed: ${reg.status}`);
  }
  const userId = reg.body?.data?.user?.id;
  if (!userId) throw new Error("no user id from register");

  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  await pool.query(
    `UPDATE users SET subscription_plan = 'business', subscription_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [userId],
  );
  await pool.end();

  await page.context().clearCookies();
  await uiLogin(page, emailHistory);
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  return userId;
}

async function cleanupTestData(userId, productIds, billIds) {
  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  if (productIds.length) {
    await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await pool.query(`DELETE FROM pos_bill_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
  }
  if (billIds.length) {
    await pool.query(`DELETE FROM pos_stock_movements WHERE bill_id = ANY($1::uuid[])`, [billIds]);
    await pool.query(`DELETE FROM pos_bill_items WHERE bill_id = ANY($1::uuid[])`, [billIds]);
    await pool.query(`DELETE FROM pos_bills WHERE id = ANY($1::uuid[])`, [billIds]);
  }
  await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [userId]);
  if (productIds.length) {
    await pool.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
  }
  await pool.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await pool.end();
}

/** A: login rizance.app → open POS → sell/upgrade page (not login prompt) */
async function caseA() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const sessionCaptures = attachSessionCapture(page);

  try {
    await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
    const reg = await registerAccount(page, emailA);
    if (reg.status !== 201 && reg.status !== 200) {
      fail("case_a_register", `status ${reg.status}`);
      return;
    }
    pass("case_a_register", `status ${reg.status}`);

    await context.clearCookies();
    await uiLogin(page, emailA);
    pass("case_a_login", `home at ${page.url()}`);

    const session = (await context.cookies()).find((c) => c.name === "rizance_session");
    if (session?.domain === ".rizance.app") pass("case_a_cookie_domain", session.domain);
    else fail("case_a_cookie_domain", session ? `got ${session.domain}` : "no rizance_session");

    await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);

    reportSession(sessionCaptures, "case_a");

    const body = await page.locator("body").innerText();
    if (isPosAuthenticated(body)) pass("case_a_pos_page", page.url());
    else fail("case_a_pos_page", `unauthenticated at ${page.url()}: ${body.slice(0, 120)}`);
  } catch (e) {
    fail("case_a", String(e));
  } finally {
    try {
      await deleteUserByEmail(emailA);
      pass("case_a_cleanup", emailA);
    } catch (e) {
      fail("case_a_cleanup", String(e));
    }
    await page.close();
    await context.close();
    await browser.close();
  }
}

/** B: incognito → POS → "ไปหน้า Login" → login → auto-return POS */
async function caseB() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const sessionCaptures = attachSessionCapture(page);

  try {
    // Create account in separate step (same as real user having an account)
    await page.goto(`${PROFIT}/login`, { waitUntil: "domcontentloaded" });
    const reg = await registerAccount(page, emailB);
    if (reg.status !== 201 && reg.status !== 200) {
      fail("case_b_register", `status ${reg.status}`);
      return;
    }
    await context.clearCookies();

    await page.goto(POS, { waitUntil: "domcontentloaded", timeout: 45000 });

    // POS auto-redirects to login on 401; fallback: click "ไปหน้า Login" link
    try {
      await page.waitForURL(/rizance\.app\/login/, { timeout: 15000 });
      pass("case_b_pos_to_login", "auto-redirect to login");
    } catch {
      const posBody = await page.locator("body").innerText();
      if (posBody.includes("ไปหน้า Login")) {
        await page.getByRole("link", { name: /ไปหน้า Login/i }).click();
        await page.waitForURL(/rizance\.app\/login/, { timeout: 15000 });
        pass("case_b_pos_to_login", "clicked login link");
      } else {
        fail("case_b_pos_to_login", `stuck at ${page.url()}: ${posBody.slice(0, 120)}`);
        return;
      }
    }
    const loginUrl = page.url();
    if (loginUrl.includes("next=")) pass("case_b_login_url_has_next", loginUrl.slice(0, 160));
    else fail("case_b_login_url_has_next", loginUrl);

    await page.locator('input[type="email"]').fill(emailB);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /log in/i }).click();

    await page.waitForURL(/pos\.rizance\.app/, { timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 });
    await page.waitForFunction(
      () => {
        const t = document.body?.innerText ?? "";
        return (
          t.includes("ต้อง upgrade เป็น Business") ||
          t.includes("สินค้า") ||
          t.includes("POS E2E")
        );
      },
      { timeout: 30000 },
    );

    reportSession(sessionCaptures, "case_b");

    const body = await page.locator("body").innerText();
    if (isPosAuthenticated(body)) pass("case_b_return_to_pos", page.url());
    else fail("case_b_return_to_pos", `landed ${page.url()}: ${body.slice(0, 120)}`);
  } catch (e) {
    fail("case_b", String(e));
  } finally {
    try {
      await deleteUserByEmail(emailB);
      pass("case_b_cleanup", emailB);
    } catch (e) {
      fail("case_b_cleanup", String(e));
    }
    await page.close();
    await context.close();
    await browser.close();
  }
}

/** C: history list → detail modal → void → cross-day window → cleanup */
async function caseHistoryVoid() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let userId = null;
  const productIds = [];
  const billIds = [];
  let billNo1 = null;
  let billId1 = null;
  let billId2 = null;
  let billNo2 = null;

  try {
    console.log(`\n=== Case C: history/void (${emailHistory}) ===\n`);

    userId = await setupBusinessUser(page);
    pass("case_c_setup_business_user", userId);

    // 1. POST product
    const prod = await posApi(page, "/api/pos/products", {
      method: "POST",
      body: JSON.stringify({ name: productName, sellPrice: 99, costPrice: 10, stockQty: 50 }),
    });
    if (prod.status !== 201) {
      fail("case_c_create_product", `status ${prod.status} ${prod.text?.slice(0, 120)}`);
      return;
    }
    const productId = prod.body?.data?.id;
    productIds.push(productId);
    pass("case_c_create_product", `${productName} (${productId})`);

    // 2. POST bills (today): bill1 for void UI, bill2 for cross-day
    const bill1 = await posApi(page, "/api/pos/bills", {
      method: "POST",
      body: JSON.stringify({
        items: [{ productId, qty: 2 }],
        paymentMethod: "cash",
      }),
    });
    if (bill1.status !== 201) {
      fail("case_c_create_bill_today", `status ${bill1.status}`);
      return;
    }
    billId1 = bill1.body?.data?.bill?.id;
    billNo1 = bill1.body?.data?.bill?.billNo;
    billIds.push(billId1);
    pass("case_c_create_bill_today", `${billNo1} total=${bill1.body?.data?.bill?.totalAmount}`);

    await assertPosJournalAndTrialBalance(userId, billId1, "case_c");

    const bill2 = await posApi(page, "/api/pos/bills", {
      method: "POST",
      body: JSON.stringify({
        items: [{ productId, qty: 1 }],
        paymentMethod: "cash",
      }),
    });
    if (bill2.status !== 201) {
      fail("case_c_create_bill_crossday_seed", `status ${bill2.status}`);
      return;
    }
    billId2 = bill2.body?.data?.bill?.id;
    billNo2 = bill2.body?.data?.bill?.billNo;
    billIds.push(billId2);
    pass("case_c_create_bill_crossday_seed", billNo2);

    // 3. Open history page
    await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
    pass("case_c_open_history", page.url());

    // 4. Bill in list
    const billRow = page.getByRole("button").filter({ hasText: billNo1 });
    if (await billRow.count()) {
      pass("case_c_bill_in_list", billNo1);
    } else {
      fail("case_c_bill_in_list", `billNo ${billNo1} not found`);
      return;
    }
    await page.screenshot({ path: join(OUT, "01-history-list.png"), fullPage: true });

    // 5. Open modal + verify line items
    await billRow.click();
    await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
    await page.waitForFunction(
      (name) => (document.querySelector('[role="dialog"]')?.textContent ?? "").includes(name),
      productName,
      { timeout: 15000 },
    );
    const modalText = await page.locator('[role="dialog"]').innerText();
    if (modalText.includes(productName) && /198(\.00)?/.test(modalText)) {
      pass("case_c_modal_items", productName);
    } else {
      fail("case_c_modal_items", modalText.slice(0, 300));
    }
    await page.screenshot({ path: join(OUT, "02-bill-detail-modal.png"), fullPage: true });

    // 6–7. Void bill1 via UI
    await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();
    await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
    await page.locator("textarea").fill(voidReason);
    await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();

    await page.waitForSelector('[role="status"]', { timeout: 15000 });
    const toastText = await page.locator('[role="status"]').innerText();
    if (toastText.includes(`ยกเลิกบิล ${billNo1}`)) {
      pass("case_c_void_toast", toastText);
    } else {
      fail("case_c_void_toast", toastText);
    }

    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    const voidedRow = page.getByRole("button").filter({ hasText: billNo1 });
    await voidedRow.waitFor({ timeout: 10000 });
    const rowText = await voidedRow.innerText();
    if (rowText.includes("ยกเลิกแล้ว")) {
      pass("case_c_void_badge", "ยกเลิกแล้ว visible");
    } else {
      fail("case_c_void_badge", rowText);
    }
    await page.screenshot({ path: join(OUT, "03-history-after-void.png"), fullPage: true });

    const detail = await posApi(page, `/api/pos/bills/${billId1}`);
    const d = detail.body?.data;
    if (detail.status === 200 && d?.status === "voided" && d?.voidedAt) {
      pass("case_c_api_bill_voided", `status=${d.status} voidedAt set`);
    } else {
      fail("case_c_api_bill_voided", `${detail.status} ${JSON.stringify(d)?.slice(0, 120)}`);
    }

    // 8. Cross-day: backdate bill2 created_at → void via UI → window message
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    await pool.query(
      `UPDATE pos_bills SET created_at = created_at - interval '1 day' WHERE id = $1`,
      [billId2],
    );
    await pool.end();
    pass("case_c_backdate_bill2", billId2);

    const bill2Row = page.getByRole("button").filter({ hasText: billNo2 });
    await bill2Row.click();
    await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
    await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();
    await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
    await page.locator("textarea").fill("should fail cross-day");
    await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();

    await page.waitForSelector("text=ยกเลิกได้เฉพาะบิลของวันนี้เท่านั้น", { timeout: 15000 });
    pass("case_c_void_window_message", "ยกเลิกได้เฉพาะบิลของวันนี้เท่านั้น");
    await page.screenshot({ path: join(OUT, "04-void-window-expired.png"), fullPage: true });

    // Close modal for clean screenshot state
    await page.getByRole("button", { name: "ไม่ยกเลิก" }).click();
    // Detail sheet may use ✕ or backdrop; try close if still open
    const closeBtn = page.getByRole("button", { name: "✕" });
    if (await closeBtn.count()) await closeBtn.click();
  } catch (e) {
    fail("case_c", String(e));
  } finally {
    if (userId) {
      try {
        await cleanupTestData(userId, productIds, billIds);
        pass("case_c_cleanup", `user ${userId}`);
      } catch (e) {
        fail("case_c_cleanup", String(e));
      }
    }
    await page.close();
    await context.close();
    await browser.close();
  }
}

/** Register page on rizance.app — only shop/booth tiles (no personal/org). */
async function caseRegisterTiles() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    console.log("\n=== Register tiles (rizance.app/register) ===\n");
    await page.goto(`${PROFIT}/register`, { waitUntil: "networkidle", timeout: 45000 });
    const body = await page.locator("body").innerText();
    const hasShop = body.includes("ร้านค้า");
    const hasBooth = body.includes("บูธ");
    const hasPersonal = body.includes("บุคคล");
    const hasOrg = body.includes("องค์กร");
    if (hasShop && hasBooth) pass("register_tiles_shop_booth", "ร้านค้า + บูธ");
    else fail("register_tiles_shop_booth", `shop=${hasShop} booth=${hasBooth}`);
    if (!hasPersonal && !hasOrg) pass("register_tiles_no_personal_org", "hidden");
    else fail("register_tiles_no_personal_org", `personal=${hasPersonal} org=${hasOrg}`);
  } catch (e) {
    fail("register_tiles", String(e));
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

/** www.rizance.com login/logout — host-only cookie (no Domain attribute). */
async function caseWwwCookie() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    console.log("\n=== www.rizance.com cookie regression ===\n");
    await page.goto(`${PROFIT_COM}/login`, { waitUntil: "domcontentloaded" });

    const reg = await page.evaluate(
      async ({ email, password }) => {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password, shopName: "WWW Cookie Shop", mode: "regular" }),
        });
        const setCookie = res.headers.getSetCookie?.() ?? [];
        return { status: res.status, setCookie };
      },
      { email: emailWww, password },
    );
    if (reg.status !== 201 && reg.status !== 200) {
      fail("www_register", `status ${reg.status}`);
      return;
    }
    pass("www_register", `status ${reg.status}`);

    const sessionHeader = (reg.setCookie ?? []).find((c) => c.startsWith("rizance_session="));
    if (sessionHeader) {
      const hasDomain = /(?:^|;\s*)Domain=/i.test(sessionHeader);
      if (!hasDomain) pass("www_cookie_host_only", "no Domain attribute");
      else fail("www_cookie_host_only", sessionHeader.slice(0, 160));
    } else {
      // Fallback: Playwright cookie jar — host-only usually stores bare hostname
      const jar = (await context.cookies()).find((c) => c.name === "rizance_session");
      if (jar && jar.domain === "www.rizance.com" && !jar.domain.startsWith(".")) {
        pass("www_cookie_host_only", `playwright domain=${jar.domain}`);
      } else {
        fail("www_cookie_host_only", jar ? `domain=${jar.domain}` : "no session cookie");
      }
    }

    await page.goto(`${PROFIT_COM}/home`, { waitUntil: "networkidle" });
    if (!page.url().includes("/login")) pass("www_home_after_register", page.url());
    else fail("www_home_after_register", page.url());

    const logoutOk = await page.evaluate(async () => {
      const r = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      return r.ok;
    });
    if (logoutOk) pass("www_logout");
    else fail("www_logout", "logout API failed");

    await page.goto(`${PROFIT_COM}/home`, { waitUntil: "networkidle" });
    if (page.url().includes("/login")) pass("www_redirect_login_after_logout", page.url());
    else fail("www_redirect_login_after_logout", page.url());
  } catch (e) {
    fail("www_cookie", String(e));
  } finally {
    try {
      await deleteUserByEmail(emailWww);
      pass("www_cleanup", emailWww);
    } catch (e) {
      fail("www_cleanup", String(e));
    }
    await page.close();
    await context.close();
    await browser.close();
  }
}

async function main() {
  console.log(`PROFIT=${PROFIT}`);
  console.log(`POS=${POS}`);
  console.log(`PROFIT_COM=${PROFIT_COM}`);
  console.log(`SESSION_API=${SESSION_API}`);
  console.log(`Screenshots: ${OUT}\n`);

  if (process.argv.includes("--auth")) {
    console.log(`Users A/B: ${emailA} / ${emailB}\n`);
    await caseA();
    console.log("");
    await caseB();
    console.log("");
  }

  await caseHistoryVoid();
  await caseRegisterTiles();
  await caseWwwCookie();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
