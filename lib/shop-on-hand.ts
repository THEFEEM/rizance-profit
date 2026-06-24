import type { PoolClient } from "pg";
import { computeProfit, sumDecimals } from "@/lib/money";
import {
  allTimeExpenseByCashTransfer,
  allTimeIncomeByCashTransfer,
  allTimeTransfersByDirection,
} from "@/lib/queries";
import { allTimeRepaymentsByMethod } from "@/lib/creditor-repayment-queries";
import { allTimeProfitWithdrawalsByMethod } from "@/lib/shop-profit-withdrawal-queries";

export type ShopOnHand = {
  cashOnHand: string;
  transferOnHand: string;
  totalOnHand: string;
};

/** All-time cash/transfer on-hand — income + transfers − expense − profit withdrawals − repayments. */
export async function computeShopOnHand(
  userId: string,
  client?: PoolClient,
): Promise<ShopOnHand> {
  const [income, expense, transfers, profitWd, repay] = await Promise.all([
    allTimeIncomeByCashTransfer(userId, client),
    allTimeExpenseByCashTransfer(userId, client),
    allTimeTransfersByDirection(userId, client),
    allTimeProfitWithdrawalsByMethod(userId, client),
    allTimeRepaymentsByMethod(userId, client),
  ]);

  const cashOnHand = computeProfit(
    sumDecimals(income.cashIncome, transfers.transferToCash),
    sumDecimals(
      expense.cashExpense,
      transfers.cashToTransfer,
      profitWd.cashWithdrawals,
      repay.cashRepayments,
    ),
  );
  const transferOnHand = computeProfit(
    sumDecimals(income.transferIncome, transfers.cashToTransfer),
    sumDecimals(
      expense.transferExpense,
      transfers.transferToCash,
      profitWd.transferWithdrawals,
      repay.transferRepayments,
    ),
  );

  return {
    cashOnHand,
    transferOnHand,
    totalOnHand: sumDecimals(cashOnHand, transferOnHand),
  };
}
