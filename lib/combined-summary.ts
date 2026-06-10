import { boothNetForPeriod } from "@/lib/booth-queries";
import { sumDecimals } from "@/lib/money";
import { periodSummary } from "@/lib/queries";
import type { PeriodKey } from "@/types";

export type CombinedPeriodSummary = {
  period: PeriodKey;
  start: string;
  end: string;
  regularProfit: string;
  boothProfit: string;
  combinedProfit: string;
};

/** Regular-shop period profit + all booths' in-period net (entry ∩ booth date range). */
export async function combinedPeriodSummary(
  userId: string,
  period: PeriodKey,
): Promise<CombinedPeriodSummary> {
  const regular = await periodSummary(userId, period);
  const boothProfit = await boothNetForPeriod(userId, regular.start, regular.end);
  return {
    period: regular.period,
    start: regular.start,
    end: regular.end,
    regularProfit: regular.profit,
    boothProfit,
    combinedProfit: sumDecimals(regular.profit, boothProfit),
  };
}
