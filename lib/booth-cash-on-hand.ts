import { query } from "@/lib/db";
import { boothSummary, getBooth } from "@/lib/booth-queries";
import { computeProfit, sumDecimals } from "@/lib/money";

export type BoothOnHand = {
  cashOnHand: string;
  transferOnHand: string;
  totalOnHand: string;
};

/** Booth cash/transfer on-hand for creditor repayment validation. */
export async function computeBoothOnHand(
  userId: string,
  boothId: string,
): Promise<BoothOnHand> {
  const empty = { cashOnHand: "0.00", transferOnHand: "0.00", totalOnHand: "0.00" };
  const booth = await getBooth(userId, boothId);
  if (!booth) return empty;

  const summary = await boothSummary(userId, boothId);
  if (!summary) return empty;

  const { rows } = await query<{ cash_expense: string; transfer_expense: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)::text AS cash_expense,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0)::text AS transfer_expense
     FROM booth_expense_entries
     WHERE booth_id = $1`,
    [boothId],
  );
  const cashExpense = rows[0].cash_expense;
  const transferExpense = rows[0].transfer_expense;

  const cashOnHand = computeProfit(
    sumDecimals(booth.totalBudget, summary.cashIncome),
    sumDecimals(cashExpense, summary.wageCost),
  );
  const transferOnHand = computeProfit(summary.transferIncome, transferExpense);

  return {
    cashOnHand,
    transferOnHand,
    totalOnHand: sumDecimals(cashOnHand, transferOnHand),
  };
}

/** @deprecated Use computeBoothOnHand for payment-method-aware balances. */
export async function computeBoothCashOnHand(
  userId: string,
  boothId: string,
): Promise<string> {
  const onHand = await computeBoothOnHand(userId, boothId);
  return onHand.totalOnHand;
}
