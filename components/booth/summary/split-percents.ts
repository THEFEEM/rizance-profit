import { toCents } from "@/lib/money";
import type { SplitProfitResult } from "@/types/booth";

function formatSplitPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Display-only percentages — mirrors BoothSplitTable, not split math. */
export function splitPercents(split: SplitProfitResult) {
  const participants = split.memberShares.filter(
    (s) =>
      (s.role === "investor" || s.role === "manager") &&
      toCents(s.investmentAmount) > 0,
  );
  const poolCents =
    split.poolGetsShare && toCents(split.poolBudget) > 0 ? toCents(split.poolBudget) : 0;
  const headCount = participants.length + (poolCents > 0 ? 1 : 0);

  if (split.method === "equal") {
    const pct = formatSplitPercent(1, headCount);
    return {
      pool: poolCents > 0 ? pct : null,
      members: new Map(participants.map((s) => [s.memberId, pct])),
    };
  }

  const equityTotal =
    participants.reduce((sum, s) => sum + toCents(s.investmentAmount), 0) + poolCents;
  return {
    pool: poolCents > 0 ? formatSplitPercent(poolCents, equityTotal) : null,
    members: new Map(
      participants.map((s) => [
        s.memberId,
        formatSplitPercent(toCents(s.investmentAmount), equityTotal),
      ]),
    ),
  };
}
