import { query } from "@/lib/db";
import { computeProfit } from "@/lib/money";
import {
  computeSplitProfit,
  inclusiveEventDays,
  type SplitMemberInput,
  type SplitProfitResult,
} from "@/lib/booth-split";
import { listShopMembers } from "@/lib/shop-member-queries";

async function shopPeriodSummary(
  userId: string,
  start: string,
  end: string,
): Promise<{ income: string; expense: string; profit: string }> {
  const { rows } = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM income_entries
                 WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date), 0)::text AS income,
       COALESCE((SELECT SUM(amount) FROM expense_entries
                 WHERE user_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date), 0)::text AS expense`,
    [userId, start, end],
  );
  const r = rows[0];
  return {
    income: r.income,
    expense: r.expense,
    profit: computeProfit(r.income, r.expense),
  };
}

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

/** Shop profit split for a date range — reuses booth computeSplitProfit (by_equity, no pool/wage/advance). */
export async function shopSplitProfit(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<SplitProfitResult | null> {
  const members = await listShopMembers(userId);
  const participants = members.filter((m) => Number(m.investmentAmount) > 0);
  if (participants.length === 0) return null;

  const summary = await shopPeriodSummary(userId, periodStart, periodEnd);

  return computeSplitProfit({
    poolBudget: "0.00",
    poolGetsShare: false,
    profitSplitMethod: "by_equity",
    startDate: periodStart,
    endDate: periodEnd,
    totalIncome: summary.income,
    totalExpense: summary.expense,
    advances: [],
    members: members.map(toSplitMemberInput),
  });
}

/** Inclusive calendar days in period — exported for GROUP 2 display labels. */
export { inclusiveEventDays as shopPeriodDays };
