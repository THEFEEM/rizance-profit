import type { PoolClient } from "pg";
import { todayAt } from "@/lib/date";
import {
  JournalEntryNotFoundError,
  postJournalEntry,
  reverseJournalEntry,
  type JournalEntry,
  type JournalLineInput,
} from "@/lib/journal-queries";
import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";
import type { PosBill, PosBillItem, PosPaymentMethod } from "@/types/pos";

const CASH_ACCOUNT = "1000";
const BANK_ACCOUNT = "1010";
const REVENUE_ACCOUNT = "4000";
const COGS_ACCOUNT = "5000";
const INVENTORY_ACCOUNT = "1200";

export type PosPostingBillInput = Pick<
  PosBill,
  "id" | "userId" | "billNo" | "totalAmount" | "paymentMethod" | "createdAt"
>;

export type PosPostingItemInput = Pick<PosBillItem, "unitCostPrice" | "quantity">;

function cashOrBankAccount(paymentMethod: PosPaymentMethod): string {
  return paymentMethod === "cash" ? CASH_ACCOUNT : BANK_ACCOUNT;
}

export type PosPostingPaymentInput = {
  method: PosPaymentMethod;
  amount: string;
};

/**
 * Bucket payments into cash (1000) vs bank (1010) debit totals.
 * promptpay + thai_chuay_thai both settle to the bank bucket.
 */
function paymentDebitLines(payments: PosPostingPaymentInput[]): JournalLineInput[] {
  let cashCents = 0;
  let bankCents = 0;
  for (const p of payments) {
    if (p.method === "cash") cashCents += toCents(p.amount);
    else bankCents += toCents(p.amount);
  }
  const lines: JournalLineInput[] = [];
  if (cashCents > 0) {
    lines.push({ accountCode: CASH_ACCOUNT, debit: centsToDecimalString(cashCents), credit: 0 });
  }
  if (bankCents > 0) {
    lines.push({ accountCode: BANK_ACCOUNT, debit: centsToDecimalString(bankCents), credit: 0 });
  }
  return lines;
}

function itemCogs(unitCostPrice: string, quantity: string): string {
  const unitCents = toCents(unitCostPrice);
  if (unitCents <= 0) return "0.00";
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "0.00";
  return centsToDecimalString(Math.round(unitCents * qty));
}

function totalCogs(items: PosPostingItemInput[]): string {
  const parts = items
    .filter((item) => toCents(item.unitCostPrice) > 0)
    .map((item) => itemCogs(item.unitCostPrice, item.quantity));
  if (parts.length === 0) return "0.00";
  return sumDecimals(...parts);
}

function billEntryDate(bill: PosPostingBillInput): string {
  // createdAt is the bill insert instant (= payment success time) because MVP has no
  // open-bill persistence — pos_bills has no paid_at column (see 0038_pos_core.sql).
  // If architecture adds draft bills or paid_at later, switch entryDate source here.
  return todayAt(new Date(bill.createdAt));
}

export function buildPosBillPaidLines(
  bill: PosPostingBillInput,
  items: PosPostingItemInput[],
  payments?: PosPostingPaymentInput[],
): JournalLineInput[] {
  const totalRevenue = bill.totalAmount;
  const cogs = totalCogs(items);

  // Split payment: one debit line per bucket. Legacy fallback: single line
  // from the bill-level method ('split' never reaches here without payments).
  const debitLines =
    payments && payments.length > 0
      ? paymentDebitLines(payments)
      : [
          {
            accountCode: cashOrBankAccount(bill.paymentMethod as PosPaymentMethod),
            debit: totalRevenue,
            credit: 0,
          },
        ];

  const lines: JournalLineInput[] = [
    ...debitLines,
    { accountCode: REVENUE_ACCOUNT, debit: 0, credit: totalRevenue },
  ];

  if (toCents(cogs) > 0) {
    lines.push(
      { accountCode: COGS_ACCOUNT, debit: cogs, credit: 0 },
      { accountCode: INVENTORY_ACCOUNT, debit: 0, credit: cogs },
    );
  }

  return lines;
}

export async function buildPosBillVoidedLines(
  client: PoolClient,
  originalEntryId: string,
  params: { description: string },
): Promise<JournalEntry> {
  return reverseJournalEntry(client, originalEntryId, params);
}

export async function postPosBillJournal(
  client: PoolClient,
  bill: PosPostingBillInput,
  items: PosPostingItemInput[],
  payments?: PosPostingPaymentInput[],
): Promise<JournalEntry> {
  const lines = buildPosBillPaidLines(bill, items, payments);
  return postJournalEntry(client, {
    userId: bill.userId,
    entryDate: billEntryDate(bill),
    description: `ขายสินค้า POS บิล ${bill.billNo}`,
    sourceModule: "pos",
    sourceEventId: bill.id,
    sourceEventType: "pos_bill_paid",
    lines,
  });
}

export async function voidPosBillJournal(
  client: PoolClient,
  bill: Pick<PosPostingBillInput, "id" | "billNo">,
): Promise<JournalEntry> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM journal_entries
     WHERE source_module = 'pos'
       AND source_event_id = $1
       AND source_event_type = 'pos_bill_paid'`,
    [bill.id],
  );

  if (rows.length !== 1) {
    throw new JournalEntryNotFoundError(bill.id);
  }

  return buildPosBillVoidedLines(client, rows[0]!.id, {
    description: `ยกเลิกบิล POS ${bill.billNo}`,
  });
}
