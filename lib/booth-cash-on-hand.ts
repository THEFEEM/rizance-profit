import { boothSummary, getBooth } from "@/lib/booth-queries";
import { computeProfit, sumDecimals } from "@/lib/money";

/** Booth cash available for creditor repayment (งบคงเหลือ + รายรับรวม). */
export async function computeBoothCashOnHand(
  userId: string,
  boothId: string,
): Promise<string> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return "0.00";

  const summary = await boothSummary(userId, boothId);
  if (!summary) return "0.00";

  const remainingBudget = computeProfit(booth.totalBudget, summary.totalExpense);
  return sumDecimals(remainingBudget, summary.totalIncome);
}
