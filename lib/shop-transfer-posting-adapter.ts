import type { PoolClient } from "pg";
import {
  postJournalEntry,
  type JournalEntry,
  type JournalLineInput,
} from "@/lib/journal-queries";
import type { MoneyTransfer } from "@/types";

const CASH_ACCOUNT = "1000";
const BANK_ACCOUNT = "1010";

export type TransferPostingInput = Pick<
  MoneyTransfer,
  "id" | "amount" | "direction" | "entryDate"
> & {
  userId: string;
};

function transferDescription(direction: MoneyTransfer["direction"]): string {
  return direction === "cash_to_transfer"
    ? "ย้ายเงิน: ฝากเข้าบัญชี"
    : "ย้ายเงิน: ถอนเป็นเงินสด";
}

/** RBP-006 journal lines — asset-to-asset, always 2 lines balanced. */
export function buildTransferJournalLines(
  direction: MoneyTransfer["direction"],
  amount: string,
): JournalLineInput[] {
  if (direction === "cash_to_transfer") {
    return [
      { accountCode: BANK_ACCOUNT, debit: amount, credit: 0 },
      { accountCode: CASH_ACCOUNT, debit: 0, credit: amount },
    ];
  }
  return [
    { accountCode: CASH_ACCOUNT, debit: amount, credit: 0 },
    { accountCode: BANK_ACCOUNT, debit: 0, credit: amount },
  ];
}

export async function postTransferJournal(
  client: PoolClient,
  transfer: TransferPostingInput,
): Promise<JournalEntry> {
  return postJournalEntry(client, {
    userId: transfer.userId,
    entryDate: transfer.entryDate,
    description: transferDescription(transfer.direction),
    sourceModule: "shop_transfer",
    sourceEventId: transfer.id,
    sourceEventType: "money_transfer_created",
    lines: buildTransferJournalLines(transfer.direction, transfer.amount),
  });
}
