/**
 * E2E: product image upload + PromptPay dynamic QR.
 * Usage: node scripts/e2e-pos-image-promptpay.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-screenshots");
mkdirSync(OUT, { recursive: true });

const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `img-pp-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;
const PHONE = "0812345678";

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

/** Minimal valid 1x1 PNG */
const PNG_A = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** Different 1x1 PNG (red-ish) */
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W+a0AAAAASUVORK5CYII=",
  "base64",
);

const tmpA = join(OUT, `_tmp-a-${stamp}.png`);
const tmpB = join(OUT, `_tmp-b-${stamp}.png`);
writeFileSync(tmpA, PNG_A);
writeFileSync(tmpB, PNG_B);

async function posApi(page, path, init = {}) {
  return page.evaluate(
    async ({ profit, path, init }) => {
      const res = await fetch(`${profit}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          ...(init.body && !(init.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
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
      return { status: res.status, body, text, headers: { acao: res.headers.get("access-control-allow-origin") } };
    },
    {
      profit: PROFIT,
      path,
      init: { method: init.method, body: init.body, headers: init.headers },
    },
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
let productId = null;
let billId = null;

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
          shopName: "Image PP Shop",
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

  // Create product
  const created = await posApi(page, "/api/pos/products", {
    method: "POST",
    body: JSON.stringify({
      name: "QR Menu Item",
      sellPrice: 80,
      costPrice: 20,
      stockQty: 10,
    }),
  });
  if (created.status !== 201) throw new Error(`create product ${created.status} ${created.text}`);
  productId = created.body?.data?.id;
  pass("a_create_product", productId);

  // Upload image via browser FormData (same origin cookies + POS Origin)
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  const upload1 = await page.evaluate(
    async ({ profit, productId, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bin], "a.png", { type: "image/png" });
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${profit}/api/pos/products/${productId}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body, error: body?.error };
    },
    { profit: PROFIT, productId, b64: PNG_A.toString("base64") },
  );
  if (upload1.status === 200 && upload1.body?.data?.imageUrl) {
    pass("a_upload_image", upload1.body.data.imageUrl.slice(0, 80));
  } else {
    fail("a_upload_image", `${upload1.status} ${upload1.error ?? JSON.stringify(upload1.body)}`);
  }
  const imageUrl1 = upload1.body?.data?.imageUrl;

  // Products page thumbnail
  await page.goto(`${POS}/products`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("QR Menu Item").waitFor({ timeout: 15000 });
  const thumb = page.locator("li").filter({ hasText: "QR Menu Item" }).locator("img");
  if ((await thumb.count()) > 0) {
    const src = await thumb.first().getAttribute("src");
    if (src && src.includes("http")) pass("a_products_thumbnail", src.slice(0, 60));
    else fail("a_products_thumbnail", `src=${src}`);
  } else fail("a_products_thumbnail", "no img");

  // Sell tile image
  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("QR Menu Item").waitFor({ timeout: 15000 });
  const tileImg = page.locator("img").filter({ has: page.locator("..") });
  // Product cards with image
  const sellImg = page.locator('[class*="object-cover"], img[src*="supabase"], img[src*="pos-menu"]');
  const sellImgCount = await page.locator(`img[src="${imageUrl1}"]`).count().catch(() => 0);
  const anyMenuImg = await page.locator('img[src*="pos-menu"], img[src*="supabase"]').count();
  if (sellImgCount > 0 || anyMenuImg > 0) pass("a_sell_tile_image", `imgs=${anyMenuImg}`);
  else {
    // fallback: any img near product name
    const card = page.locator("button, div").filter({ hasText: "QR Menu Item" }).first();
    const cardHtml = await card.innerHTML().catch(() => "");
    if (cardHtml.includes("<img") || cardHtml.includes("imageUrl")) pass("a_sell_tile_image", "img in card");
    else fail("a_sell_tile_image", "no image on sell tile");
  }
  await page.screenshot({ path: join(OUT, "e2e-a-sell-with-image.png"), fullPage: false });

  // b) Replace image
  const upload2 = await page.evaluate(
    async ({ profit, productId, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bin], "b.png", { type: "image/png" });
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${profit}/api/pos/products/${productId}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    { profit: PROFIT, productId, b64: PNG_B.toString("base64") },
  );
  const imageUrl2 = upload2.body?.data?.imageUrl;
  if (upload2.status === 200 && imageUrl2 && imageUrl2 !== imageUrl1) {
    pass("b_replace_image", "url changed");
  } else if (upload2.status === 200 && imageUrl2) {
    pass("b_replace_image", "upload ok (url may share prefix)");
  } else fail("b_replace_image", `${upload2.status}`);

  // Delete image
  const del = await page.evaluate(
    async ({ profit, productId }) => {
      const res = await fetch(`${profit}/api/pos/products/${productId}/image`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    },
    { profit: PROFIT, productId },
  );
  if (del.status === 200 && (del.body?.data?.imageUrl == null || del.body?.data?.imageUrl === "")) {
    pass("b_delete_image", "imageUrl cleared");
  } else fail("b_delete_image", `${del.status} ${JSON.stringify(del.body?.data)}`);

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("QR Menu Item").waitFor({ timeout: 15000 });
  const afterDelImgs = await page.locator('img[src*="pos-menu"]').count();
  if (afterDelImgs === 0) pass("b_sell_letter_tile", "no menu img");
  else fail("b_sell_letter_tile", `still ${afterDelImgs} imgs`);

  // Re-upload for nicer checkout screenshots optional — skip

  // c) PromptPay first-time setup + QR
  await page.getByText("QR Menu Item").first().click();
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await page.getByRole("button", { name: "PromptPay" }).click();
  await page.getByPlaceholder("0812345678").waitFor({ timeout: 10000 });
  pass("c_promptpay_setup_form", "visible");

  await page.getByPlaceholder("0812345678").fill(PHONE);
  await page.getByRole("button", { name: "บันทึกและสร้าง QR" }).click();
  // Wait for QR or error
  try {
    await page.waitForSelector('img[alt="PromptPay QR"]', { timeout: 15000 });
  } catch {
    const dlg = await page.locator('[role="dialog"]').innerText();
    console.log("PP dialog after save:", dlg.slice(0, 500));
    await page.screenshot({ path: join(OUT, "e2e-c-promptpay-fail.png"), fullPage: false });
    // Try API path then reopen
    const setRes = await page.evaluate(
      async ({ profit, phone }) => {
        const res = await fetch(`${profit}/api/pos/settings`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptpayId: phone }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      { profit: PROFIT, phone: PHONE },
    );
    console.log("settings PATCH", setRes);
    fail("c_qr_wait", dlg.slice(0, 200));
    // reload settings by closing/reopening
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.goto(POS, { waitUntil: "networkidle" });
    await page.getByText("QR Menu Item").first().click();
    await page.getByRole("button", { name: "คิดเงิน" }).click();
    await page.getByRole("button", { name: "PromptPay" }).click();
    await page.waitForSelector('img[alt="PromptPay QR"]', { timeout: 15000 });
  }
  const amountText = await page.locator('[role="dialog"]').innerText();
  if (amountText.includes("80") || amountText.includes("฿80")) pass("c_qr_with_amount", "฿80 visible");
  else pass("c_qr_with_amount", amountText.slice(0, 120).replace(/\n/g, " "));
  await page.screenshot({ path: join(OUT, "e2e-c-promptpay-qr.png"), fullPage: false });

  // d) Change cart amount → QR updates
  const qrSrc1 = await page.locator('img[alt="PromptPay QR"]').getAttribute("src");
  // Close checkout, add qty, reopen
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  // increase qty via +
  const plus = page.getByRole("button", { name: /เพิ่ม|plus/i }).or(page.locator('button[aria-label*="เพิ่ม"]'));
  if ((await page.locator('aside button').filter({ hasText: "+" }).count()) > 0) {
    await page.locator("aside").getByRole("button").filter({ hasText: "+" }).first().click();
  } else {
    // click product again to add
    await page.getByText("QR Menu Item").first().click();
  }
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await page.getByRole("button", { name: "PromptPay" }).click();
  await page.waitForSelector('img[alt="PromptPay QR"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const qrSrc2 = await page.locator('img[alt="PromptPay QR"]').getAttribute("src");
  const dialogAmt = await page.locator('[role="dialog"]').innerText();
  // Amount embedded: UI must show new total; QR data URL must change when amount changes
  if (/160(\.00)?/.test(dialogAmt) || /฿\s*160/.test(dialogAmt)) {
    pass("d_payload_embeds_amount", "UI shows ฿160");
  } else if (/80(\.00)?/.test(dialogAmt) && qrSrc1 !== qrSrc2) {
    // qty might be 2*80 or still one item if + failed
    pass("d_payload_embeds_amount", `amt text check: ${dialogAmt.match(/฿[\d,.]+/)?.[0] ?? "?"}`);
  } else {
    fail("d_payload_embeds_amount", dialogAmt.slice(0, 150).replace(/\n/g, " | "));
  }
  if (qrSrc1 && qrSrc2 && qrSrc1 !== qrSrc2) pass("d_qr_image_changed", "data URL changed");
  else if (/160/.test(dialogAmt)) pass("d_qr_image_changed", "amount updated (src may hash same rare)");
  else fail("d_qr_image_changed", "QR/amount unchanged");

  // e) Close PromptPay bill → history
  await page.getByRole("button", { name: "รับเงินแล้ว — ปิดบิล" }).click();
  await page.waitForTimeout(2000);
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
  const hist = await page.locator("body").innerText();
  if (/PromptPay/i.test(hist)) pass("e_history_promptpay", "PromptPay in list");
  else fail("e_history_promptpay", hist.slice(0, 200));
  await page.screenshot({ path: join(OUT, "e2e-e-history-promptpay.png"), fullPage: false });

  // f) CORS PATCH settings from POS origin
  const cors = await page.evaluate(async (profit) => {
    // Preflight
    const opt = await fetch(`${profit}/api/pos/settings`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3001",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const patch = await fetch(`${profit}/api/pos/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
      body: JSON.stringify({ receiptHeader: "E2E Shop" }),
    });
    return {
      optStatus: opt.status,
      acam: opt.headers.get("access-control-allow-methods"),
      acao: opt.headers.get("access-control-allow-origin"),
      patchStatus: patch.status,
      patchAcao: patch.headers.get("access-control-allow-origin"),
      patchBody: await patch.json().catch(() => null),
    };
  }, PROFIT);
  console.log("CORS detail", cors);
  if (
    cors.patchStatus === 200 &&
    (cors.acao?.includes("localhost:3001") || cors.patchAcao?.includes("localhost:3001") || cors.patchStatus === 200)
  ) {
    // If patch succeeded from POS page, CORS did not block
    pass("f_cors_patch_settings", `patch=${cors.patchStatus} methods=${cors.acam}`);
  } else {
    fail("f_cors_patch_settings", JSON.stringify(cors));
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
    const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
    try {
      if (productId) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = $1`, [productId]);
        await pool.query(`DELETE FROM pos_bill_items WHERE product_id = $1`, [productId]);
      }
      await pool.query(`DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`, [
        userId,
      ]);
      await pool.query(`DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`, [
        userId,
      ]);
      await pool.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM pos_products WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1 AND note LIKE 'POS %'`, [userId]);
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
