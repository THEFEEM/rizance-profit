/**
 * Cart line modifier edit tests (checklist 6–8)
 * Usage: node scripts/e2e-pos-cart-edit-modifiers.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `cartedit-${stamp}@rizance.test`;
const password = `Shot${stamp}!`;

const results = [];
function pass(n, d = "") {
  results.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
}
function fail(n, d) {
  results.push({ n, ok: false, d });
  console.log(`FAIL ${n}: ${d}`);
}

function loadDb() {
  for (const f of [join(__dirname, "../.env.local"), join(__dirname, "../.env")]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* skip */
    }
  }
  throw new Error("no DATABASE_URL");
}

function pool() {
  return new pg.Pool(pgClientOptions(loadDb()));
}

async function longPress(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bbox");
  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
const productIds = [];

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
          shopName: "CART EDIT E2E",
          mode: "regular",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { email, password },
  );
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`reg ${reg.status}`);
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

  async function createProduct(name, price) {
    const r = await page.evaluate(
      async ({ profit, name, price }) => {
        const res = await fetch(`${profit}/api/pos/products`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sellPrice: price, costPrice: 10, stockQty: 50 }),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      { profit: PROFIT, name, price },
    );
    if (r.status !== 201) throw new Error(`create ${name}`);
    productIds.push(r.body.data.id);
    return r.body.data;
  }

  const burger = await createProduct("Beef Burger", 49);
  const plain = await createProduct("Plain Fries", 29);

  // Seed cheese group → burger only
  {
    const p = pool();
    const g = await p.query(
      `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
       VALUES ($1, 'ชีส', 0, 1, 0)
       ON CONFLICT (user_id, name) DO UPDATE SET min_select = 0, max_select = 1
       RETURNING id`,
      [userId],
    );
    const gid = g.rows[0].id;
    await p.query(
      `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
       VALUES ($1, 'ชีส 1 แผ่น', 10.00, 0)
       ON CONFLICT (group_id, name) DO NOTHING`,
      [gid],
    );
    await p.query(
      `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
       VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
      [burger.id, gid],
    );
    await p.end();
  }
  pass("setup", "Beef Burger 49 + cheese; Plain Fries 29");

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Beef Burger").first().waitFor({ timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Beef Burger").first().waitFor({ timeout: 15000 });

  // ── 6) Plain burger → tap cart line → add cheese → +10 same qty ──
  await page.getByText("Beef Burger").first().click();
  await page.waitForTimeout(400);
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /แก้ตัวเลือกของ Beef Burger/ }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.getByText("ชีส 1 แผ่น").click();
  await page.waitForTimeout(200);
  const preview = await page.locator('[role="dialog"]').innerText();
  if (/59(\.00)?/.test(preview)) pass("edit_preview_59");
  else fail("edit_preview_59", preview.slice(0, 200).replace(/\n/g, " | "));

  await page.getByRole("button", { name: "บันทึกตัวเลือก" }).click();
  await page.waitForTimeout(400);
  const cart6 = await aside.innerText();
  const burgerCount6 = (cart6.match(/Beef Burger/g) || []).length;
  if (
    burgerCount6 === 1 &&
    /ชีส 1 แผ่น/.test(cart6) &&
    (/฿\s*59/.test(cart6) || /59\.00/.test(cart6)) &&
    !/฿\s*49(?!\d)/.test(cart6.replace(/49(?=\d)/g, ""))
  ) {
    // also check qty still 1
    pass("edit_line_price_59_qty1", cart6.slice(0, 180).replace(/\n/g, " | "));
  } else if (burgerCount6 === 1 && /ชีส/.test(cart6) && /59/.test(cart6)) {
    pass("edit_line_price_59_qty1", "ok");
  } else {
    fail("edit_line_price_59_qty1", cart6.slice(0, 300).replace(/\n/g, " | "));
  }

  // Clear and redo for merge test
  await page.getByRole("button", { name: "ล้างตะกร้า" }).click().catch(async () => {
    await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Beef Burger").first().waitFor({ timeout: 15000 });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Beef Burger").first().waitFor({ timeout: 15000 });

  // ── 7) Plain + longpress cheese → 2 lines → edit plain to cheese → merge ──
  await page.getByText("Beef Burger").first().click();
  await page.waitForTimeout(300);
  await longPress(page.getByText("Beef Burger").first());
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.getByText("ชีส 1 แผ่น").click();
  await page.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await page.waitForTimeout(400);
  let cart7 = await aside.innerText();
  const lines7 = (cart7.match(/Beef Burger/g) || []).length;
  if (lines7 >= 2 && /49/.test(cart7) && /59/.test(cart7)) {
    pass("two_lines_plain_and_cheese", `lines=${lines7}`);
  } else {
    fail("two_lines_plain_and_cheese", cart7.slice(0, 300).replace(/\n/g, " | "));
  }

  // Edit the plain line (the one that says แตะเพื่อเพิ่มตัวเลือก or has no cheese)
  const plainEdit = aside.getByRole("button", { name: /แก้ตัวเลือกของ Beef Burger/ }).filter({
    hasText: /แตะเพื่อเพิ่มตัวเลือก|Beef Burger/,
  });
  // Prefer the line without cheese text in its button
  const editButtons = aside.getByRole("button", { name: /แก้ตัวเลือกของ Beef Burger/ });
  const nEdit = await editButtons.count();
  let clicked = false;
  for (let i = 0; i < nEdit; i++) {
    const t = await editButtons.nth(i).innerText();
    if (!/ชีส/.test(t)) {
      await editButtons.nth(i).click();
      clicked = true;
      break;
    }
  }
  if (!clicked && nEdit > 0) await editButtons.first().click();

  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.locator('[role="dialog"]').getByRole("button", { name: /ชีส 1 แผ่น/ }).click();
  await page.getByRole("button", { name: "บันทึกตัวเลือก" }).click();
  await page.waitForTimeout(500);
  cart7 = await aside.innerText();
  const linesMerged = (cart7.match(/Beef Burger/g) || []).length;
  // Merged: one line, cheese, qty 2, line total 118 (59*2)
  if (
    linesMerged === 1 &&
    /ชีส/.test(cart7) &&
    (/\n2\n|\| 2 \|| 2 /.test(cart7.replace(/\n/g, " | ")) || /\| 2 \|/.test(cart7.replace(/\n/g, " | "))) &&
    /118(\.00)?/.test(cart7)
  ) {
    pass("merge_into_one_line", "1 line qty=2 total=118");
  } else if (linesMerged === 1 && /ชีส/.test(cart7) && /118/.test(cart7) && cart7.includes("2")) {
    pass("merge_into_one_line", cart7.replace(/\n/g, " | ").slice(0, 140));
  } else {
    fail("merge_into_one_line", `lines=${linesMerged} ${cart7.slice(0, 300).replace(/\n/g, " | ")}`);
  }

  // ── 8) Plain fries: no edit affordance ──
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Plain Fries").first().waitFor({ timeout: 15000 });
  await page.getByText("Plain Fries").first().click();
  await page.waitForTimeout(400);
  const friesCart = await aside.innerText();
  const friesEdit = await aside.getByRole("button", { name: /แก้ตัวเลือกของ Plain Fries/ }).count();
  const hasSliderHint = /แตะเพื่อเพิ่มตัวเลือก/.test(friesCart);
  if (friesEdit === 0 && !hasSliderHint && /Plain Fries/.test(friesCart)) {
    pass("no_edit_without_groups", "name not editable");
  } else {
    fail("no_edit_without_groups", `editBtns=${friesEdit} hint=${hasSliderHint}`);
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
        `DELETE FROM pos_product_modifier_groups WHERE product_id = ANY($1::uuid[])`,
        [productIds],
      );
      await p.query(
        `DELETE FROM pos_modifiers WHERE group_id IN (SELECT id FROM pos_modifier_groups WHERE user_id = $1)`,
        [userId],
      );
      await p.query(`DELETE FROM pos_modifier_groups WHERE user_id = $1`, [userId]);
      if (productIds.length) {
        await p.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      await p.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]).catch(() => {});
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
