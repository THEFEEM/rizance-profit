/**
 * Phase O write test — #13 modifier snapshot + #22 promptpay invariants
 * Requires NON-PROD DATABASE_URL (e.g. local Docker).
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/rizance"
 *   npx tsx scripts/phase-o-13-22-write.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isProductionDb, pgClientOptions } from "./pg-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Do not silently load .env.local — caller must set DATABASE_URL explicitly.
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL explicitly to a non-prod DB.");
  process.exit(1);
}
if (isProductionDb(process.env.DATABASE_URL)) {
  console.error("Refusing write test against PRODUCTION.");
  process.exit(1);
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
function pass(name: string, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ""}`);
}
function fail(name: string, detail = "") {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}: ${detail}`);
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function main() {
const client = new pg.Client(pgClientOptions(process.env.DATABASE_URL!));
await client.connect();

const stamp = Date.now();
const email = `phase-o-${stamp}@rizance.test`;
let userId: string | null = null;

try {
  // Seed chart of accounts if empty
  const coa = await client.query(`SELECT count(*)::int AS n FROM chart_of_accounts`);
  if (coa.rows[0].n === 0) {
    await client.query(`
      INSERT INTO chart_of_accounts (account_code, account_name, display_name, account_type, normal_balance)
      VALUES
        ('1000', 'เงินสด', 'เงินสด', 'asset', 'debit'),
        ('1010', 'เงินฝากธนาคาร', 'เงินในบัญชีธนาคาร', 'asset', 'debit'),
        ('1200', 'สินค้าคงเหลือ', 'สต็อกสินค้า', 'asset', 'debit'),
        ('2000', 'เจ้าหนี้การค้า', 'ค้างจ่ายซัพพลายเออร์', 'liability', 'credit'),
        ('3000', 'ทุน–เจ้าของ', 'ทุนของเจ้าของ', 'equity', 'credit'),
        ('3100', 'เงินปันผล/ถอนกำไร', 'ถอนกำไร', 'equity', 'debit'),
        ('4000', 'รายได้จากการขาย', 'ยอดขาย', 'revenue', 'credit'),
        ('5000', 'ต้นทุนขาย', 'ต้นทุนสินค้าที่ขาย', 'expense', 'debit'),
        ('5900', 'ค่าใช้จ่ายอื่น', 'ค่าใช้จ่ายทั่วไป', 'expense', 'debit')
      ON CONFLICT DO NOTHING
    `);
    pass("seed_coa", "9 accounts");
  } else {
    pass("seed_coa", `already ${coa.rows[0].n}`);
  }

  const userIns = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, shop_name, subscription_plan, subscription_expires_at)
     VALUES ($1, 'x', 'Phase O Test', 'business', now() + interval '30 days')
     RETURNING id`,
    [email],
  );
  userId = userIns.rows[0].id;
  pass("setup_user", userId);

  await client.query(
    `INSERT INTO pos_shop_settings (user_id, promptpay_id, shop_qr_url, shop_qr_note)
     VALUES ($1, '0812345678', 'https://example.com/shop-qr.png', 'บัญชีทดสอบ Phase O')
     ON CONFLICT (user_id) DO UPDATE SET
       promptpay_id = EXCLUDED.promptpay_id,
       shop_qr_url = EXCLUDED.shop_qr_url,
       shop_qr_note = EXCLUDED.shop_qr_note`,
    [userId],
  );
  pass("setup_shop_qr", "promptpay + shop_qr_url");

  const prod = await client.query<{ id: string }>(
    `INSERT INTO pos_products (user_id, name, sell_price, cost_price, stock_qty, track_stock)
     VALUES ($1, $2, 49.00, 20.00, 100, false)
     RETURNING id`,
    [userId, `O-Burger-${stamp}`],
  );
  const productId = prod.rows[0].id;

  const grp = await client.query<{ id: string }>(
    `INSERT INTO pos_modifier_groups (user_id, name, min_select, max_select, sort_order)
     VALUES ($1, 'ชีส', 0, 1, 0)
     RETURNING id`,
    [userId],
  );
  const groupId = grp.rows[0].id;

  const mod = await client.query<{ id: string; name: string; price_delta: string }>(
    `INSERT INTO pos_modifiers (group_id, name, price_delta, sort_order)
     VALUES ($1, 'ชีส 1 แผ่น', 10.00, 0)
     RETURNING id, name, price_delta::text`,
    [groupId],
  );
  const modifierId = mod.rows[0].id;
  pass("setup_modifier", `${mod.rows[0].name} +${mod.rows[0].price_delta}`);

  await client.query(
    `INSERT INTO pos_product_modifier_groups (product_id, group_id, sort_order)
     VALUES ($1, $2, 0)`,
    [productId, groupId],
  );

  // Import app modules AFTER DATABASE_URL is set (singleton pool)
  const { closePosBill } = await import("../lib/pos-close-bill-queries");
  const { getPosBillDetail } = await import("../lib/pos-bill-queries");
  const { updatePosModifier } = await import("../lib/pos-modifier-queries");

  const bill = await closePosBill(userId, {
    items: [{ productId, qty: 1, modifierIds: [modifierId] }],
    paymentMethod: "promptpay",
    entryDate: todayBangkok(),
  });

  const detailBefore = await getPosBillDetail(userId, bill.bill.id);
  const snap = detailBefore?.items?.[0]?.modifiers?.[0];

  if (snap?.modifierName === "ชีส 1 แผ่น" && parseFloat(snap.priceDelta) === 10) {
    pass("13_snapshot_at_sale", `${snap.modifierName} +${snap.priceDelta}`);
  } else {
    fail("13_snapshot_at_sale", JSON.stringify(snap));
  }

  await updatePosModifier(userId, modifierId, { name: "ชีสพิเศษ NEW", priceDelta: 99 });

  const live = await client.query<{ name: string; price_delta: string }>(
    `SELECT name, price_delta::text FROM pos_modifiers WHERE id = $1`,
    [modifierId],
  );
  if (live.rows[0]?.name === "ชีสพิเศษ NEW" && parseFloat(live.rows[0].price_delta) === 99) {
    pass("13_live_catalog_updated", `${live.rows[0].name} +${live.rows[0].price_delta}`);
  } else {
    fail("13_live_catalog_updated", JSON.stringify(live.rows[0]));
  }

  const detailAfter = await getPosBillDetail(userId, bill.bill.id);
  const snapAfter = detailAfter?.items?.[0]?.modifiers?.[0];
  if (snapAfter?.modifierName === "ชีส 1 แผ่น" && parseFloat(snapAfter.priceDelta) === 10) {
    pass(
      "13_old_bill_unchanged",
      `after rename, bill still ${snapAfter.modifierName} +${snapAfter.priceDelta}`,
    );
  } else {
    fail("13_old_bill_unchanged", JSON.stringify(snapAfter));
  }

  const lineTotal = detailAfter?.items?.[0]?.lineTotal;
  if (parseFloat(lineTotal ?? "0") === 59 && parseFloat(bill.bill.totalAmount) === 59) {
    pass("13_line_total_frozen", `line=${lineTotal} bill=${bill.bill.totalAmount}`);
  } else {
    fail("13_line_total_frozen", `line=${lineTotal} bill=${bill.bill.totalAmount}`);
  }

  // #22 — shop QR tab is UI-only; checkout still posts promptpay
  if (bill.bill.paymentMethod === "promptpay") {
    pass("22_payment_method_promptpay", bill.bill.billNo);
  } else {
    fail("22_payment_method_promptpay", bill.bill.paymentMethod);
  }

  const inv = await client.query<{ payment_method: string; total: string; sum_lines: string }>(
    `SELECT b.payment_method, b.total_amount::text AS total,
            COALESCE(SUM(bi.line_total),0)::text AS sum_lines
     FROM pos_bills b
     JOIN pos_bill_items bi ON bi.bill_id = b.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [bill.bill.id],
  );
  if (parseFloat(inv.rows[0].total) === parseFloat(inv.rows[0].sum_lines)) {
    pass("22_sum_line_eq_total", `${inv.rows[0].total} = ${inv.rows[0].sum_lines}`);
  } else {
    fail("22_sum_line_eq_total", JSON.stringify(inv.rows[0]));
  }

  const journal = await client.query<{ d: string; c: string }>(
    `SELECT COALESCE(SUM(jl.debit),0)::text AS d, COALESCE(SUM(jl.credit),0)::text AS c
     FROM journal_entries je
     JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE je.source_module = 'pos' AND je.source_event_type = 'pos_bill_paid'
       AND je.source_event_id = $1`,
    [bill.bill.id],
  );
  if (parseFloat(journal.rows[0].d) === parseFloat(journal.rows[0].c) && parseFloat(journal.rows[0].d) > 0) {
    pass("22_debit_eq_credit", `debit=credit=${journal.rows[0].d}`);
  } else {
    fail("22_debit_eq_credit", JSON.stringify(journal.rows[0]));
  }

  // income maps promptpay → transfer
  const income = await client.query<{ payment_method: string; amount: string }>(
    `SELECT payment_method, amount::text FROM income_entries WHERE id = $1`,
    [bill.bill.incomeEntryId],
  );
  if (income.rows[0]?.payment_method === "transfer" && parseFloat(income.rows[0].amount) === 59) {
    pass("22_income_transfer", `transfer ${income.rows[0].amount}`);
  } else {
    fail("22_income_transfer", JSON.stringify(income.rows[0]));
  }

  const settings = await client.query(
    `SELECT shop_qr_url, promptpay_id FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  if (settings.rows[0]?.shop_qr_url && settings.rows[0]?.promptpay_id) {
    pass("22_both_qr_tabs_configured", "PayQrTabs would show PromptPay + QR ร้าน");
  } else {
    fail("22_both_qr_tabs_configured", JSON.stringify(settings.rows[0]));
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (userId) {
    try {
      await client.query(
        `DELETE FROM pos_bill_item_modifiers WHERE bill_item_id IN (
           SELECT bi.id FROM pos_bill_items bi JOIN pos_bills b ON b.id = bi.bill_id WHERE b.user_id = $1)`,
        [userId],
      );
      await client.query(
        `DELETE FROM pos_bill_payments WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await client.query(`DELETE FROM pos_stock_movements WHERE user_id = $1`, [userId]);
      await client.query(
        `DELETE FROM pos_bill_items WHERE bill_id IN (SELECT id FROM pos_bills WHERE user_id = $1)`,
        [userId],
      );
      await client.query(
        `DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE user_id = $1)`,
        [userId],
      );
      await client.query(`DELETE FROM journal_entries WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM income_entries WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM pos_bills WHERE user_id = $1`, [userId]);
      await client.query(
        `DELETE FROM pos_product_modifier_groups WHERE product_id IN (SELECT id FROM pos_products WHERE user_id = $1)`,
        [userId],
      );
      await client.query(
        `DELETE FROM pos_modifiers WHERE group_id IN (SELECT id FROM pos_modifier_groups WHERE user_id = $1)`,
        [userId],
      );
      await client.query(`DELETE FROM pos_modifier_groups WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM pos_products WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM pos_bill_counters WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM pos_shop_settings WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      console.log("cleanup ok");
    } catch (ce) {
      console.warn("cleanup error:", ce instanceof Error ? ce.message : ce);
    }
  }
  await client.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} write checks passed`);
if (failed.length) {
  console.log("FAILED:", failed);
  process.exitCode = 1;
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
