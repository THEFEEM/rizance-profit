import { computeProfit, toCents } from "@/lib/money";

export type BreakEvenComparison = "above" | "below" | "at" | null;

export type BreakEvenItem = {
  /** selling price − variable (ingredient) cost per cup */
  contributionPerCup: string;
  breakEvenCups: number | null;
  noBreakEven: boolean;
  warning: string | null;
  comparison: BreakEvenComparison;
};

/** Contribution margin = selling price − variable (ingredient) cost per cup. */
export function computeContributionPerCup(
  sellingPriceExact: string,
  ingredientCostPerCup: string,
): string {
  return computeProfit(sellingPriceExact, ingredientCostPerCup);
}

/** Fixed monthly overheads not yet entered (sum is zero). */
export function breakEvenNeedsSetup(fixedCostsMonthly: string): boolean {
  return toCents(fixedCostsMonthly) <= 0;
}

export function computeBreakEvenCups(
  fixedCostsMonthly: string,
  contributionPerCup: string,
): number | null {
  const contribCents = toCents(contributionPerCup);
  if (contribCents <= 0) return null;
  return Math.ceil(toCents(fixedCostsMonthly) / contribCents);
}

export function computeBreakEvenItem(
  fixedCostsMonthly: string,
  ingredientCostPerCup: string,
  sellingPriceExact: string,
  estimatedCupsPerMonth: number,
  needsSetup: boolean,
): BreakEvenItem {
  const contributionPerCup = computeContributionPerCup(sellingPriceExact, ingredientCostPerCup);
  const contribCents = toCents(contributionPerCup);

  if (contribCents <= 0) {
    return {
      contributionPerCup,
      breakEvenCups: null,
      noBreakEven: true,
      warning: "ราคานี้ไม่ถึงจุดคุ้มทุน — กำไรต่อแก้วติดลบ/ศูนย์",
      comparison: null,
    };
  }

  if (needsSetup) {
    return {
      contributionPerCup,
      breakEvenCups: null,
      noBreakEven: false,
      warning: null,
      comparison: null,
    };
  }

  const breakEvenCups = computeBreakEvenCups(fixedCostsMonthly, contributionPerCup);
  let comparison: BreakEvenComparison = null;
  if (estimatedCupsPerMonth > 0 && breakEvenCups !== null) {
    if (estimatedCupsPerMonth > breakEvenCups) comparison = "above";
    else if (estimatedCupsPerMonth < breakEvenCups) comparison = "below";
    else comparison = "at";
  }

  return {
    contributionPerCup,
    breakEvenCups,
    noBreakEven: false,
    warning: null,
    comparison,
  };
}
