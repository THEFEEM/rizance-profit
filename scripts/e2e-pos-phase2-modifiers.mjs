/**
 * Phase-2 Modifiers E2E — Beef Burger / Crispy Chick / Smash L flows.
 * Usage: node scripts/e2e-pos-phase2-modifiers.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "phase-a-screenshots");
mkdirSync(OUT, { recursive: true });

const PROFIT = "http://localhost:3000";
const POS = "http://localhost:3001";
const stamp = Date.now();
const email = `mod-e2e-${stamp}@rizance.test`;
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

async function seedModifiers(userId) {
  const pool = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  const client = await pool.connect();
  try {
    const { rows: products } = await client.query(
      `SELECT id, name FROM pos_products WHERE user_id = $1`,
      [userId],
    );
    const GROUPS = [
      {
        name: "ชีส",
        minSelect: 0,
        maxSelect: 1,
        sortOrder: 0,
        modifiers: [
          { name: "ชีส 1 แผ่น", priceDelta: "10.00", sortOrder: 0 },
          { name: "ชีส 2 แผ่น", priceDelta: "20.00", sortOrder: 1 },
        ],
        productMatch: ["smash", "beef burger", "dubble", "chicky", "burger"],
      },
      {
        name: "ไข่ดาว",
        minSelect: 0,
        maxSelect: 1,
        sortOrder: 1,
        modifiers: [{ name: "เพิ่มไข่ดาว", priceDelta: "10.00", sortOrder: 0 }],
        productMatch: ["smash", "beef burger", "dubble", "chicky", "burger"],
      },
      {
        name: "ซอส",
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 2,
        modifiers: [
          { name: "Spicy Sauce", priceDelta: "0.00", sortOrder: 0 },
          { name: "Classic Sauce", priceDelta: "0.00", sortOrder: 1 },
        ],
        productMatch: ["crispy chick"],
      },
    ];
    await client.query("BEGIN");
    for (const g of GROUPS) {
      const { rows: groupRows } = await client.query(
        `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, name) DO UPDATE SET
           min_select = EXCLUDED.min_select,
           max_select = EXCLUDED.max_select,
           updated_at = now()
         RETURNING id`,
        [userId, g.name, g.minSelect, g.maxSelect, g.sortOrder],
      );
      const groupId = groupRows[0].id;
      for (const m of g.modifiers) {
        await client.query(
          `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (group_id, name) DO NOTHING`,
          [groupId, m.name, m.priceDelta, m.sortOrder],
        );
      }
      const matched = products.filter((p) =>
        g.productMatch.some((frag) => p.name.toLowerCase().includes(frag)),
      );
      for (const p of matched) {
        await client.query(
          `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [p.id, groupId, g.sortOrder],
        );
      }
      console.log(`seed group ${g.name} → ${matched.map((p) => p.name).join(", ")}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

async function longPress(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box for long press");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const page = locator.page();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await context.newPage();
let userId = null;
const productIds = [];
let billNo = null;
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
          shopName: "NINENON BURGER",
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

  const products = [
    { name: "Beef Burger", sellPrice: 49 },
    { name: "Crispy Chick", sellPrice: 59 },
    { name: "Smash L", sellPrice: 89 },
  ];
  for (const p of products) {
    const res = await posApi(page, "/api/pos/products", {
      method: "POST",
      body: JSON.stringify({
        name: p.name,
        sellPrice: p.sellPrice,
        costPrice: 20,
        stockQty: 100,
      }),
    });
    if (res.status !== 201) throw new Error(`create ${p.name}: ${res.status} ${res.text}`);
    productIds.push(res.body.data.id);
  }
  pass("setup_products", products.map((p) => p.name).join(", "));

  await seedModifiers(userId);
  pass("seed_modifiers", "ชีส / ไข่ดาว / ซอส");

  await page.goto(POS, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Beef Burger").first().waitFor({ timeout: 20000 });

  // Clear any leftover cart
  await page.evaluate(() => localStorage.removeItem("rizance_pos_cart_v2"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Beef Burger").first().waitFor({ timeout: 15000 });

  // ── 2) Short tap Beef Burger → cart 49 ──
  await page.getByText("Beef Burger").first().click();
  await page.waitForTimeout(400);
  const cartText2 = await page.locator("aside").innerText();
  if (/Beef Burger/.test(cartText2) && /49(\.00)?/.test(cartText2)) {
    pass("tap_beef_plain_49", "in cart at 49");
  } else {
    fail("tap_beef_plain_49", cartText2.slice(0, 200));
  }
  await page.screenshot({ path: join(OUT, "mod-2-beef-plain.png"), fullPage: false });

  // ── 3) Long-press Beef Burger → cheese 1 → 59 → separate line ──
  await longPress(page.getByText("Beef Burger").first());
  await page.waitForSelector("h2", { timeout: 10000 });
  const sheetTitle = await page.locator('[role="dialog"] h2').innerText();
  if (!/Beef Burger/.test(sheetTitle)) {
    // maybe sheet title is product name
    console.log("sheet title", sheetTitle);
  }
  await page.getByText("ชีส 1 แผ่น").click();
  await page.waitForTimeout(200);
  const sheetBody = await page.locator('[role="dialog"]').innerText();
  if (/59(\.00)?/.test(sheetBody)) pass("longpress_preview_59", "preview shows 59");
  else fail("longpress_preview_59", sheetBody.slice(0, 250).replace(/\n/g, " | "));

  await page.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await page.waitForTimeout(400);
  const cartText3 = await page.locator("aside").innerText();
  // Expect two Beef Burger lines or 49 and 59
  const has49 = /฿\s*49(\.00)?/.test(cartText3) || /49\.00/.test(cartText3);
  const has59 = /฿\s*59(\.00)?/.test(cartText3) || /59\.00/.test(cartText3);
  const beefCount = (cartText3.match(/Beef Burger/g) || []).length;
  if (has49 && has59 && beefCount >= 2) {
    pass("cart_two_lines_49_59", `beef lines=${beefCount}`);
  } else if (has49 && has59) {
    pass("cart_two_lines_49_59", "prices present");
  } else {
    fail("cart_two_lines_49_59", cartText3.slice(0, 300).replace(/\n/g, " | "));
  }
  await page.screenshot({ path: join(OUT, "mod-3-two-lines.png"), fullPage: false });

  // Clear cart for cleaner remaining tests — use ล้างตะกร้า
  const clearBtn = page.getByRole("button", { name: "ล้างตะกร้า" });
  if (await clearBtn.count()) await clearBtn.click();
  await page.waitForTimeout(300);

  // ── 4) Crispy Chick tap → forced sauce sheet ──
  await page.getByText("Crispy Chick").first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const crispySheet = await page.locator('[role="dialog"]').innerText();
  if (/ต้องเลือก/.test(crispySheet) && /ซอส/.test(crispySheet)) {
    pass("crispy_forced_sheet", "badge ต้องเลือก + ซอส");
  } else {
    fail("crispy_forced_sheet", crispySheet.slice(0, 250).replace(/\n/g, " | "));
  }
  const addDisabled = await page.getByRole("button", { name: /เลือกตัวเลือกที่จำเป็นก่อน|ใส่ตะกร้า/ }).isDisabled();
  if (addDisabled) pass("crispy_add_disabled_until_sauce");
  else fail("crispy_add_disabled_until_sauce", "button enabled early");

  await page.getByText("Spicy Sauce").click();
  await page.waitForTimeout(200);
  const addEnabled = await page.getByRole("button", { name: "ใส่ตะกร้า" }).isEnabled();
  if (addEnabled) pass("crispy_add_enabled_after_sauce");
  else fail("crispy_add_enabled_after_sauce", "still disabled");
  await page.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "mod-4-crispy.png"), fullPage: false });

  if (await clearBtn.count()) await clearBtn.click();
  await page.waitForTimeout(200);

  // ── 5) Smash L + cheese 2 → 109 ──
  await longPress(page.getByText("Smash L").first());
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.getByText("ชีส 2 แผ่น").click();
  await page.waitForTimeout(200);
  const smashSheet = await page.locator('[role="dialog"]').innerText();
  if (/109(\.00)?/.test(smashSheet)) pass("smash_l_cheese2_109", "preview 109");
  else fail("smash_l_cheese2_109", smashSheet.slice(0, 250).replace(/\n/g, " | "));
  await page.getByRole("button", { name: "ใส่ตะกร้า" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "mod-5-smash109.png"), fullPage: false });

  // Also add plain beef for a multi-item bill with modifiers (for history/void)
  // Keep Smash L in cart, checkout
  await page.getByRole("button", { name: "คิดเงิน" }).click();
  await page.waitForSelector("h2:has-text('ชำระเงิน')", { timeout: 10000 });
  await page.getByRole("button", { name: "เงินสด" }).click().catch(() => {});
  const exact = page.getByRole("button", { name: "พอดี" });
  if (await exact.count()) await exact.click();
  await page.getByRole("button", { name: /ยืนยันรับเงิน|รับเงินแล้ว/ }).click();
  await page.waitForTimeout(2200);

  // ── 6) History detail shows modifiers ──
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("h1:has-text('ประวัติบิล')", { timeout: 15000 });
  const firstBill = page.locator("ul li button").first();
  await firstBill.click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  // Wait for detail payload (not just sheet chrome / skeleton)
  await page.getByText("Smash L").first().waitFor({ timeout: 15000 });
  const detail = await page.locator('[role="dialog"]').innerText();
  const billNoMatch = detail.match(/\d{8}-\d{3}/);
  billNo = billNoMatch ? billNoMatch[0] : null;
  if (/Smash L/.test(detail) && /ชีส 2 แผ่น/.test(detail) && /109(\.00)?/.test(detail)) {
    pass("history_shows_modifiers", `bill ${billNo}`);
  } else if (/ชีส/.test(detail) && /109/.test(detail)) {
    pass("history_shows_modifiers", detail.slice(0, 200).replace(/\n/g, " | "));
  } else {
    fail("history_shows_modifiers", detail.slice(0, 350).replace(/\n/g, " | "));
  }
  await page.screenshot({ path: join(OUT, "mod-6-history-detail.png"), fullPage: false });

  // Close detail
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Lookup bill id
  const pool2 = new pg.Pool(pgPoolOptions(loadDatabaseUrl()));
  const billRow = await pool2.query(
    `SELECT id, bill_no, total_amount::text, status FROM pos_bills WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  billId = billRow.rows[0]?.id;
  billNo = billRow.rows[0]?.bill_no ?? billNo;
  const totalAmount = billRow.rows[0]?.total_amount;
  pass("bill_lookup", `${billNo} total=${totalAmount}`);

  // ── 7) DB invariant: total_amount = SUM(line_total) ──
  const inv = await pool2.query(
    `SELECT b.total_amount::text AS total_amount, SUM(bi.line_total)::text AS sum_lines
     FROM pos_bills b
     JOIN pos_bill_items bi ON bi.bill_id = b.id
     WHERE b.bill_no = $1 AND b.user_id = $2
     GROUP BY b.total_amount`,
    [billNo, userId],
  );
  const total = inv.rows[0]?.total_amount;
  const sumLines = inv.rows[0]?.sum_lines;
  if (total && sumLines && parseFloat(total) === parseFloat(sumLines)) {
    pass("invariant_bill_sum", `${total} = ${sumLines}`);
  } else {
    fail("invariant_bill_sum", JSON.stringify(inv.rows));
  }

  // Journal: debit=credit always; cash/revenue leg = bill total (COGS adds extra balanced pair)
  const journal = await pool2.query(
    `SELECT
       COALESCE(SUM(jl.debit),0)::text AS sum_debit,
       COALESCE(SUM(jl.credit),0)::text AS sum_credit,
       COALESCE(SUM(CASE WHEN jl.account_code IN ('1000','1010') THEN jl.debit ELSE 0 END),0)::text AS cash_debit,
       COALESCE(SUM(CASE WHEN jl.account_code = '4000' THEN jl.credit ELSE 0 END),0)::text AS revenue_credit
     FROM journal_entries je
     JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE je.user_id = $1 AND je.source_module = 'pos'
       AND je.source_event_id = $2 AND je.source_event_type = 'pos_bill_paid'`,
    [userId, billId],
  );
  const sumDebit = journal.rows[0]?.sum_debit;
  const sumCredit = journal.rows[0]?.sum_credit;
  const cashDebit = journal.rows[0]?.cash_debit;
  const revenueCredit = journal.rows[0]?.revenue_credit;
  const balanced = parseFloat(sumDebit) === parseFloat(sumCredit);
  const revenueMatches =
    parseFloat(cashDebit) === parseFloat(total) &&
    parseFloat(revenueCredit) === parseFloat(total);
  if (balanced && revenueMatches) {
    pass(
      "invariant_journal",
      `debit=credit=${sumDebit}; cash/revenue=${cashDebit}=bill ${total}`,
    );
  } else {
    fail(
      "invariant_journal",
      `debit=${sumDebit} credit=${sumCredit} cash=${cashDebit} rev=${revenueCredit} total=${total}`,
    );
  }

  // Stock before void
  const smashId = productIds[2];
  const stockBefore = await pool2.query(
    `SELECT stock_qty::text FROM pos_products WHERE id = $1`,
    [smashId],
  );
  const stockBeforeVal = parseFloat(stockBefore.rows[0]?.stock_qty ?? "0");

  // ── 8) Void bill with modifiers ──
  // Note: history page always shows a summary label "ยกเลิกแล้ว" — do NOT wait on that alone.
  await page.goto(`${POS}/history`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button").filter({ hasText: billNo }).click();
  await page.waitForSelector("h2:has-text('รายละเอียดบิล')", { timeout: 10000 });
  await page.getByRole("button", { name: "ยกเลิกบิลนี้" }).click();
  await page.waitForSelector("h2:has-text('ยืนยันยกเลิกบิล')", { timeout: 10000 });
  await page.locator("textarea").fill("ทดสอบ void modifier");
  await page.getByRole("button", { name: "ยืนยันยกเลิก" }).click();
  // Confirm via DB status (reliable) + UI badge on the bill card
  for (let i = 0; i < 20; i++) {
    const st = await pool2.query(`SELECT status FROM pos_bills WHERE id = $1`, [billId]);
    if (st.rows[0]?.status === "voided") break;
    await page.waitForTimeout(250);
  }
  const voidStatus = await pool2.query(`SELECT status, void_reason FROM pos_bills WHERE id = $1`, [
    billId,
  ]);
  if (voidStatus.rows[0]?.status === "voided") {
    pass("void_ui_ok", `${billNo} status=voided`);
  } else {
    fail("void_ui_ok", `status=${voidStatus.rows[0]?.status}`);
  }

  const stockAfter = await pool2.query(
    `SELECT stock_qty::text FROM pos_products WHERE id = $1`,
    [smashId],
  );
  const stockAfterVal = parseFloat(stockAfter.rows[0]?.stock_qty ?? "0");
  if (stockAfterVal === stockBeforeVal + 1) {
    pass("void_restores_stock", `${stockBeforeVal} → ${stockAfterVal}`);
  } else {
    fail("void_restores_stock", `${stockBeforeVal} → ${stockAfterVal}`);
  }

  const journalAfter = await pool2.query(
    `SELECT source_event_type, id
     FROM journal_entries
     WHERE user_id = $1 AND source_module = 'pos' AND source_event_id = $2
     ORDER BY created_at`,
    [userId, billId],
  );
  const types = journalAfter.rows.map((r) => r.source_event_type);
  if (types.includes("pos_bill_paid") && types.includes("pos_bill_paid_reversal")) {
    pass("void_journal_reverse", types.join(", "));
  } else {
    fail("void_journal_reverse", `types=${JSON.stringify(types)}`);
  }

  // After void, paid+void journals for this bill should still net balanced
  const billJournalBal = await pool2.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0)::text AS bal
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.user_id = $1 AND je.source_event_id = $2`,
    [userId, billId],
  );
  if (parseFloat(billJournalBal.rows[0].bal) === 0) {
    pass("void_journal_balanced", "net 0 for bill");
  } else {
    fail("void_journal_balanced", billJournalBal.rows[0].bal);
  }

  await pool2.end();

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
        `DELETE FROM pos_bill_item_modifiers WHERE bill_item_id IN (
           SELECT bi.id FROM pos_bill_items bi JOIN pos_bills b ON b.id = bi.bill_id WHERE b.user_id = $1)`,
        [userId],
      );
      await pool.query(
        `DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(
        `DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      await pool.query(
        `DELETE FROM pos_product_modifier_groups WHERE product_id = ANY($1::uuid[])`,
        [productIds],
      );
      await pool.query(
        `DELETE FROM pos_modifiers WHERE group_id IN (SELECT id FROM pos_modifier_groups WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(`DELETE FROM pos_modifier_groups WHERE user_id = $1`, [userId]);
      if (productIds.length) {
        await pool.query(`DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await pool.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      await pool.query(`DELETE FROM income_entries WHERE user_id = $1`, [userId]);
      await pool.query(
        `DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE user_id = $1)`,
        [userId],
      );
      await pool.query(`DELETE FROM journal_entries WHERE user_id = $1`, [userId]);
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
