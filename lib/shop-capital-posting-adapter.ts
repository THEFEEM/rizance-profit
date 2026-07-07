import type { PoolClient } from "pg";
import {
  postJournalEntry,
  type JournalEntry,
  type JournalLineInput,
} from "@/lib/journal-queries";
import type { CapitalDirection } from "@/types/shop";

const CASH_ACCOUNT = "1000";
const BANK_ACCOUNT = "1010";
const EQUITY_ACCOUNT = "3000";

export type CapitalPaymentMethod = "cash" | "transfer";

export type CapitalPostingInput = {
  id: string;
  userId: string;
  amount: string;
  direction: CapitalDirection;
  paymentMethod: CapitalPaymentMethod;
  entryDate: string;
  memberName?: string;
};

function paymentAccount(paymentMethod: CapitalPaymentMethod): string {
  return paymentMethod === "cash" ? CASH_ACCOUNT : BANK_ACCOUNT;
}

function capitalDescription(direction: CapitalDirection, memberName?: string): string {
  const base = direction === "contribution" ? "เพิ่มทุน" : "ถอนทุน";
  return memberName ? `${base}: ${memberName}` : base;
}

/** RBP-007 journal lines — asset ↔ equity, always 2 lines balanced. */
export function buildCapitalJournalLines(
  direction: CapitalDirection,
  paymentMethod: CapitalPaymentMethod,
  amount: string,
): JournalLineInput[] {
  const asset = paymentAccount(paymentMethod);
  if (direction === "contribution") {
    return [
      { accountCode: asset, debit: amount, credit: 0 },
      { accountCode: EQUITY_ACCOUNT, debit: 0, credit: amount },
    ];
  }
  return [
    { accountCode: EQUITY_ACCOUNT, debit: amount, credit: 0 },
    { accountCode: asset, debit: 0, credit: amount },
  ];
}

export async function postCapitalJournal(
  client: PoolClient,
  capitalTx: CapitalPostingInput,
): Promise<JournalEntry> {
  return postJournalEntry(client, {
    userId: capitalTx.userId,
    entryDate: capitalTx.entryDate,
    description: capitalDescription(capitalTx.direction, capitalTx.memberName),
    sourceModule: "shop_capital",
    sourceEventId: capitalTx.id,
    sourceEventType: "capital_transaction_created",
    lines: buildCapitalJournalLines(capitalTx.direction, capitalTx.paymentMethod, capitalTx.amount),
  });
}
