import { allTimeSummary } from "@/lib/queries";
import {
  computeSplitProfit,
  inclusiveEventDays,
  type SplitMemberInput,
  type SplitProfitResult,
} from "@/lib/booth-split";
import { listShopMembers } from "@/lib/shop-member-queries";

function toSplitMemberInput(m: {
  id: string;
  name: string;
  role: "investor" | "manager";
  investmentAmount: string;
}): SplitMemberInput {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    investmentAmount: m.investmentAmount,
    wageAmount: null,
    wageType: null,
  };
}

/** Shop profit split — all-time P&L, repay capital before equity split. */
export async function shopSplitProfit(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<SplitProfitResult | null> {
  const members = await listShopMembers(userId);
  const participants = members.filter((m) => Number(m.investmentAmount) > 0);
  if (participants.length === 0) return null;

  const allTime = await allTimeSummary(userId);

  return computeSplitProfit({
    poolBudget: "0.00",
    poolGetsShare: false,
    profitSplitMethod: "by_equity",
    startDate: periodStart,
    endDate: periodEnd,
    totalIncome: allTime.income,
    totalExpense: allTime.expense,
    advances: [],
    members: members.map(toSplitMemberInput),
    repayCapitalFirst: true,
  });
}

/** Inclusive calendar days in period — exported for GROUP 2 display labels. */
export { inclusiveEventDays as shopPeriodDays };
