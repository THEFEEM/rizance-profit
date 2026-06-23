import { today } from "@/lib/date";
import { centsToDecimalString, computeProfit, toCents } from "@/lib/money";
import { listShopMembers } from "@/lib/shop-member-queries";
import { sumWithdrawnByMembers } from "@/lib/shop-profit-withdrawal-queries";
import { shopSplitProfit } from "@/lib/shop-split";
import type { MemberProfitWithdrawable } from "@/types/shop";

/** splittable × (member capital / total capital) — paper profit share. */
export function memberAccumulatedShare(
  splittable: string,
  investmentAmount: string,
  totalCapital: string,
): string {
  const denom = toCents(totalCapital);
  if (denom <= 0) return "0.00";
  const shareCents = Math.trunc((toCents(splittable) * toCents(investmentAmount)) / denom);
  return centsToDecimalString(shareCents);
}

function nonNegative(amount: string): string {
  const c = toCents(amount);
  return c > 0 ? centsToDecimalString(c) : "0.00";
}

export async function shopMemberProfitWithdrawable(
  userId: string,
): Promise<MemberProfitWithdrawable[]> {
  const [split, members, withdrawnMap] = await Promise.all([
    shopSplitProfit(userId, today(), today()),
    listShopMembers(userId),
    sumWithdrawnByMembers(userId),
  ]);

  if (!split) return [];

  const splittable = split.splittableProfit ?? "0.00";
  const totalCapital = split.totalCapital ?? split.memberEquity;

  return members
    .filter((m) => toCents(m.investmentAmount) > 0)
    .map((m) => {
      const accumulated = memberAccumulatedShare(
        splittable,
        m.investmentAmount,
        totalCapital,
      );
      const withdrawn = withdrawnMap.get(m.id) ?? "0.00";
      const available = nonNegative(computeProfit(accumulated, withdrawn));

      return {
        memberId: m.id,
        name: m.name,
        role: m.role,
        investmentAmount: m.investmentAmount,
        accumulatedShare: accumulated,
        withdrawn,
        available,
      };
    });
}

export async function getMemberProfitWithdrawable(
  userId: string,
  memberId: string,
): Promise<MemberProfitWithdrawable | null> {
  const rows = await shopMemberProfitWithdrawable(userId);
  return rows.find((r) => r.memberId === memberId) ?? null;
}
