/**
 * POS closePosBill smoke test — direct DB + closePosBill() (no HTTP).
 *
 * Usage:
 *   TEST_USER_ID=<uuid> npx tsx scripts/pos-smoke-test.ts
 *
 * Requires: DATABASE_URL, migrations 0038 + 0040 + 0043 + 0044 applied, TEST_USER_ID = existing users.id
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pgPoolOptions } from "../lib/pg-config";
import { today } from "../lib/date";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(join(ROOT, file), "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch {
      // optional
    }
  }
}

loadEnv();

type CheckResult = { name: string; ok: boolean; detail?: string };

const results: CheckResult[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail?: string): void {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function assert(name: string, cond: boolean, detail?: string): void {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

type Counts = {
  bills: number;
  billItems: number;
  stockMovements: number;
  incomeEntries: number;
  journalEntries: number;
  journalLines: number;
};

async function fetchCounts(client: pg.Client, userId: string): Promise<Counts> {
  const bills = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM pos_bills WHERE user_id = $1`,
    [userId],
  );
  const billItems = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM pos_bill_items bi
     JOIN pos_bills b ON b.id = bi.bill_id
     WHERE b.user_id = $1`,
    [userId],
  );
  const stockMovements = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM pos_stock_movements WHERE user_id = $1`,
    [userId],
  );
  const incomeEntries = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM income_entries WHERE user_id = $1`,
    [userId],
  );
  const journalEntries = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM journal_entries WHERE user_id = $1`,
    [userId],
  );
  const journalLines = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.user_id = $1`,
    [userId],
  );
  return {
    bills: Number(bills.rows[0].n),
    billItems: Number(billItems.rows[0].n),
    stockMovements: Number(stockMovements.rows[0].n),
    incomeEntries: Number(incomeEntries.rows[0].n),
    journalEntries: Number(journalEntries.rows[0].n),
    journalLines: Number(journalLines.rows[0].n),
  };
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS ok`,
    [table],
  );
  return rows[0]?.ok === true;
}

async function cleanup(
  client: pg.Client,
  userId: string,
  productIds: string[],
  billIds: string[],
  incomeIds: string[],
): Promise<void> {
  if (billIds.length) {
    await client.query(
      `DELETE FROM journal_entries
       WHERE source_module = 'pos' AND source_event_id = ANY($1::uuid[])`,
      [billIds],
    );
    await client.query(`DELETE FROM pos_stock_movements WHERE bill_id = ANY($1::uuid[])`, [
      billIds,
    ]);
    await client.query(`DELETE FROM pos_bill_items WHERE bill_id = ANY($1::uuid[])`, [billIds]);
    await client.query(`DELETE FROM pos_bills WHERE id = ANY($1::uuid[])`, [billIds]);
  }
  if (incomeIds.length) {
    await client.query(`DELETE FROM income_entries WHERE id = ANY($1::uuid[])`, [incomeIds]);
  }
  if (productIds.length) {
    await client.query(
      `DELETE FROM pos_stock_movements WHERE product_id = ANY($1::uuid[])`,
      [productIds],
    );
    await client.query(`DELETE FROM pos_products WHERE id = ANY($1::uuid[])`, [productIds]);
  }
  await client.query(
    `DELETE FROM pos_bill_counters WHERE user_id = $1 AND counter_date = $2::date`,
    [userId, today()],
  );
}

async function main(): Promise<void> {
  const userId = process.env.TEST_USER_ID?.trim();
  if (!userId) {
    console.error("TEST_USER_ID is required");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { closePosBill, PosProductNotFoundError, POS_TO_INCOME_PAYMENT_METHOD } = await import(
    "../lib/pos-close-bill-queries"
  );

  const client = new pg.Client(pgPoolOptions(process.env.DATABASE_URL));
  await client.connect();

  const productIds: string[] = [];
  const billIds: string[] = [];
  const incomeIds: string[] = [];
  let restoredSubscription = false;
  let prevPlan: string | null = null;
  let prevExpires: string | null = null;

  try {
    assert("0038 pos_products table exists", await tableExists(client, "pos_products"));
    assert("0045 journal_entries table exists", await tableExists(client, "journal_entries"));

    const userCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    assert("TEST_USER_ID exists in users", userCheck.rowCount === 1, userId);

    const subRow = await client.query<{ subscription_plan: string; subscription_expires_at: Date | null }>(
      `SELECT subscription_plan, subscription_expires_at FROM users WHERE id = $1`,
      [userId],
    );
    prevPlan = subRow.rows[0]?.subscription_plan ?? null;
    prevExpires = subRow.rows[0]?.subscription_expires_at
      ? new Date(subRow.rows[0].subscription_expires_at).toISOString()
      : null;

    await client.query(
      `UPDATE users
       SET subscription_plan = 'business',
           subscription_expires_at = now() + interval '30 days'
       WHERE id = $1`,
      [userId],
    );
    restoredSubscription = true;

    const stamp = Date.now();
    const p1 = await client.query<{ id: string }>(
      `INSERT INTO pos_products (user_id, name, sell_price, cost_price, stock_qty, track_stock)
       VALUES ($1, $2, 50.00, 20.00, 10, true)
       RETURNING id`,
      [userId, `POS-SMOKE-A-${stamp}`],
    );
    const p2 = await client.query<{ id: string }>(
      `INSERT INTO pos_products (user_id, name, sell_price, cost_price, stock_qty, track_stock)
       VALUES ($1, $2, 30.00, 10.00, 0, false)
       RETURNING id`,
      [userId, `POS-SMOKE-B-${stamp}`],
    );
    const productA = p1.rows[0].id;
    const productB = p2.rows[0].id;
    productIds.push(productA, productB);
    pass("seed 2 test products", `${productA}, ${productB}`);

    const entryDate = today();
    const result = await closePosBill(userId, {
      items: [
        { productId: productA, qty: 2 },
        { productId: productB, qty: 1 },
      ],
      paymentMethod: "cash",
      entryDate,
    });

    billIds.push(result.bill.id);
    if (result.bill.incomeEntryId) incomeIds.push(result.bill.incomeEntryId);

    const billNoRe = /^\d{8}-\d{3}$/;
    assert("pos_bills created", !!result.bill.id);
    assert("bill_no format YYYYMMDD-XXX", billNoRe.test(result.bill.billNo), result.bill.billNo);
    assert("bill status paid", result.bill.status === "paid");
    assert("bill_items count = 2", result.items.length === 2, String(result.items.length));

    const itemA = result.items.find((i) => i.productId === productA);
    const itemB = result.items.find((i) => i.productId === productB);
    assert("bill_item A snapshot qty=2 total=100", 
      Number(itemA?.quantity) === 2 && parseFloat(itemA?.lineTotal ?? "0") === 100);
    assert("bill_item B snapshot qty=1 total=30", 
      Number(itemB?.quantity) === 1 && parseFloat(itemB?.lineTotal ?? "0") === 30);
    assert("bill total_amount 130.00", result.bill.totalAmount === "130.00", result.bill.totalAmount);

    const stockA = await client.query<{ stock_qty: string }>(
      `SELECT stock_qty::text FROM pos_products WHERE id = $1`,
      [productA],
    );
    assert("stock A remaining 8", parseFloat(stockA.rows[0]?.stock_qty ?? "0") === 8, stockA.rows[0]?.stock_qty);

    const movements = await client.query<{ n: string; qty_change: string }>(
      `SELECT COUNT(*)::text AS n,
              COALESCE(SUM(qty_change), 0)::text AS qty_change
       FROM pos_stock_movements
       WHERE bill_id = $1`,
      [result.bill.id],
    );
    assert(
      "stock_movements 1 sale row qty=-2",
      movements.rows[0]?.n === "1" && parseFloat(movements.rows[0]?.qty_change ?? "0") === -2,
      `n=${movements.rows[0]?.n} sum=${movements.rows[0]?.qty_change}`,
    );

    const income = await client.query<{ category: string; note: string; amount: string }>(
      `SELECT category, note, amount::text FROM income_entries WHERE id = $1`,
      [result.bill.incomeEntryId],
    );
    const inc = income.rows[0];
    assert(
      "income_entries category storefront + note POS bill_no",
      inc?.category === "storefront" && inc?.note === `POS ${result.bill.billNo}`,
      inc ? `${inc.category} / ${inc.note}` : "missing",
    );
    assert("income_entries amount 130.00", inc?.amount === "130.00", inc?.amount);

    assert(
      "pos_bills.income_entry_id linked",
      !!result.bill.incomeEntryId,
      result.bill.incomeEntryId ?? "null",
    );
    const linkCheck = await client.query<{ income_entry_id: string }>(
      `SELECT income_entry_id FROM pos_bills WHERE id = $1`,
      [result.bill.id],
    );
    assert(
      "income_entry_id FK matches income row",
      linkCheck.rows[0]?.income_entry_id === result.bill.incomeEntryId,
    );

    const journalPaid = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries
       WHERE user_id = $1 AND source_event_id = $2 AND source_event_type = 'pos_bill_paid'`,
      [userId, result.bill.id],
    );
    assert(
      "journal_entries: 1 pos_bill_paid row after cash bill",
      journalPaid.rows[0]?.n === "1",
      journalPaid.rows[0]?.n,
    );

    const journalLineCount = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.source_event_id = $1 AND je.source_event_type = 'pos_bill_paid'`,
      [result.bill.id],
    );
    assert(
      "journal_lines: 4 lines (COGS from product A cost>0)",
      journalLineCount.rows[0]?.n === "4",
      journalLineCount.rows[0]?.n,
    );

    const promptpayResult = await closePosBill(userId, {
      items: [{ productId: productB, qty: 1 }],
      paymentMethod: "promptpay",
      entryDate,
    });
    billIds.push(promptpayResult.bill.id);
    if (promptpayResult.bill.incomeEntryId) {
      incomeIds.push(promptpayResult.bill.incomeEntryId);
    }

    const billPm = await client.query<{ payment_method: string }>(
      `SELECT payment_method FROM pos_bills WHERE id = $1`,
      [promptpayResult.bill.id],
    );
    assert(
      "promptpay bill: pos_bills.payment_method=promptpay",
      billPm.rows[0]?.payment_method === "promptpay",
      billPm.rows[0]?.payment_method,
    );

    const incomePm = await client.query<{ payment_method: string }>(
      `SELECT payment_method FROM income_entries WHERE id = $1`,
      [promptpayResult.bill.incomeEntryId],
    );
    const expectedIncomePm = POS_TO_INCOME_PAYMENT_METHOD.promptpay;
    assert(
      "promptpay bill: income_entries.payment_method mapped",
      incomePm.rows[0]?.payment_method === expectedIncomePm,
      `${incomePm.rows[0]?.payment_method} (expected ${expectedIncomePm})`,
    );

    const { voidPosBill, PosVoidWindowExpiredError } = await import("../lib/pos-bill-queries");
    const voidReason = "smoke void test";
    const voidResult = await voidPosBill(userId, result.bill.id, voidReason);
    assert("voidPosBill returns voided", voidResult.status === "voided");

    const journalForBill = await client.query<{
      id: string;
      source_event_type: string;
      reversed_by_entry_id: string | null;
    }>(
      `SELECT id, source_event_type, reversed_by_entry_id
       FROM journal_entries
       WHERE source_module = 'pos' AND source_event_id = $1
       ORDER BY created_at ASC`,
      [result.bill.id],
    );
    assert(
      "void journal: 2 entries (paid + reversal)",
      journalForBill.rows.length === 2 &&
        journalForBill.rows.some((r) => r.source_event_type === "pos_bill_paid") &&
        journalForBill.rows.some((r) => r.source_event_type === "pos_bill_paid_reversal"),
    );
    const paidEntry = journalForBill.rows.find((r) => r.source_event_type === "pos_bill_paid");
    const reversalEntry = journalForBill.rows.find(
      (r) => r.source_event_type === "pos_bill_paid_reversal",
    );
    assert(
      "void journal: reversed_by_entry_id links paid → reversal",
      paidEntry?.reversed_by_entry_id === reversalEntry?.id,
      `${paidEntry?.reversed_by_entry_id} → ${reversalEntry?.id}`,
    );

    const paidLines = await client.query<{ account_code: string; debit: string; credit: string }>(
      `SELECT account_code, debit::text, credit::text
       FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [paidEntry!.id],
    );
    const reversalLines = await client.query<{ account_code: string; debit: string; credit: string }>(
      `SELECT account_code, debit::text, credit::text
       FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
      [reversalEntry!.id],
    );
    const linesSwapped =
      paidLines.rows.length === reversalLines.rows.length &&
      paidLines.rows.every((orig, i) => {
        const rev = reversalLines.rows[i];
        return orig.debit === rev.credit && orig.credit === rev.debit;
      });
    assert("void journal: reversal lines swap debit/credit", linesSwapped);

    const billTrialBalance = await client.query<{ account_code: string; balance: string }>(
      `SELECT jl.account_code, SUM(jl.debit) - SUM(jl.credit) AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.source_module = 'pos' AND je.source_event_id = $1
       GROUP BY jl.account_code`,
      [result.bill.id],
    );
    const billTrialSum = billTrialBalance.rows.reduce((s, r) => s + Number(r.balance), 0);
    assert(
      "void journal: per-bill trial balance nets to 0",
      Math.abs(billTrialSum) < 0.001,
      String(billTrialSum),
    );

    const voidedIncome = await client.query<{
      voided_at: Date | null;
      void_reason: string | null;
    }>(
      `SELECT voided_at, void_reason FROM income_entries WHERE id = $1`,
      [result.bill.incomeEntryId],
    );
    const vi = voidedIncome.rows[0];
    assert(
      "income entry still exists after void (soft-void)",
      !!vi,
      result.bill.incomeEntryId ?? "missing id",
    );
    assert(
      "income entry voided_at IS NOT NULL",
      vi?.voided_at != null,
      vi?.voided_at ? String(vi.voided_at) : "null",
    );
    assert(
      "income entry void_reason matches",
      vi?.void_reason === voidReason,
      vi?.void_reason ?? "null",
    );

    const voidedBill = await client.query<{ status: string }>(
      `SELECT status FROM pos_bills WHERE id = $1`,
      [result.bill.id],
    );
    assert("pos_bills status voided", voidedBill.rows[0]?.status === "voided");

    const staleBill = await closePosBill(userId, {
      items: [{ productId: productB, qty: 1 }],
      paymentMethod: "cash",
      entryDate,
    });
    billIds.push(staleBill.bill.id);
    if (staleBill.bill.incomeEntryId) incomeIds.push(staleBill.bill.incomeEntryId);
    await client.query(
      `UPDATE pos_bills SET created_at = created_at - interval '1 day' WHERE id = $1`,
      [staleBill.bill.id],
    );

    const staleJournalBefore = await client.query<{
      id: string;
      source_event_type: string;
    }>(
      `SELECT id, source_event_type FROM journal_entries
       WHERE source_module = 'pos' AND source_event_id = $1
       ORDER BY created_at ASC`,
      [staleBill.bill.id],
    );
    assert(
      "stale bill: 1 journal entry before void attempt",
      staleJournalBefore.rows.length === 1 &&
        staleJournalBefore.rows[0]?.source_event_type === "pos_bill_paid",
    );

    let windowExpired = false;
    try {
      await voidPosBill(userId, staleBill.bill.id, "late void");
    } catch (err) {
      windowExpired = err instanceof PosVoidWindowExpiredError;
    }
    assert("void yesterday bill throws PosVoidWindowExpiredError", windowExpired);

    const staleJournalAfter = await client.query<{
      id: string;
      source_event_type: string;
    }>(
      `SELECT id, source_event_type FROM journal_entries
       WHERE source_module = 'pos' AND source_event_id = $1
       ORDER BY created_at ASC`,
      [staleBill.bill.id],
    );
    assert(
      "stale bill: journal unchanged after failed void",
      staleJournalAfter.rows.length === staleJournalBefore.rows.length &&
        staleJournalAfter.rows[0]?.id === staleJournalBefore.rows[0]?.id &&
        !staleJournalAfter.rows.some((r) => r.source_event_type === "pos_bill_paid_reversal"),
    );

    const staleBillStatus = await client.query<{ status: string }>(
      `SELECT status FROM pos_bills WHERE id = $1`,
      [staleBill.bill.id],
    );
    assert(
      "stale bill: still paid after failed void",
      staleBillStatus.rows[0]?.status === "paid",
    );

    const countsBeforeError = await fetchCounts(client, userId);

    let rolledBack = false;
    try {
      await closePosBill(userId, {
        items: [{ productId: randomUUID(), qty: 1 }],
        paymentMethod: "cash",
        entryDate,
      });
      fail("bogus productId should throw", "no error thrown");
    } catch (err) {
      rolledBack = err instanceof PosProductNotFoundError;
      assert("bogus productId throws PosProductNotFoundError", rolledBack);
    }

    const countsAfterError = await fetchCounts(client, userId);
    assert(
      "rollback: pos_bills count unchanged",
      countsAfterError.bills === countsBeforeError.bills,
      `${countsBeforeError.bills} → ${countsAfterError.bills}`,
    );
    assert(
      "rollback: pos_bill_items count unchanged",
      countsAfterError.billItems === countsBeforeError.billItems,
    );
    assert(
      "rollback: pos_stock_movements count unchanged",
      countsAfterError.stockMovements === countsBeforeError.stockMovements,
    );
    assert(
      "rollback: income_entries count unchanged",
      countsAfterError.incomeEntries === countsBeforeError.incomeEntries,
    );
    assert(
      "rollback: journal_entries count unchanged",
      countsAfterError.journalEntries === countsBeforeError.journalEntries,
    );
    assert(
      "rollback: journal_lines count unchanged",
      countsAfterError.journalLines === countsBeforeError.journalLines,
    );

    const trialBalance = await client.query<{ account_code: string; balance: string }>(
      `SELECT jl.account_code, SUM(jl.debit) - SUM(jl.credit) AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.user_id = $1
       GROUP BY jl.account_code
       ORDER BY jl.account_code`,
      [userId],
    );
    console.log("\n--- trial balance (test user) ---");
    let trialSum = 0;
    for (const row of trialBalance.rows) {
      console.log(`  ${row.account_code}: ${row.balance}`);
      trialSum += Number(row.balance);
    }
    console.log(`  SUM(all balances): ${trialSum}`);
    assert("trial balance sums to 0", Math.abs(trialSum) < 0.001, String(trialSum));
  } finally {
    await cleanup(client, userId, productIds, billIds, incomeIds);
    if (restoredSubscription && prevPlan != null) {
      await client.query(
        `UPDATE users
         SET subscription_plan = $2,
             subscription_expires_at = $3
         WHERE id = $1`,
        [userId, prevPlan, prevExpires],
      );
    }
    pass("cleanup test data for TEST_USER_ID");
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} passed ---`);
  if (failed.length) {
    console.log("Failed:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
