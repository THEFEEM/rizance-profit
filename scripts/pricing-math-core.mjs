/**
 * Pure pricing math for scripts — keep in sync with lib/pricing-math.ts + lib/pricing-units.ts.
 */

export function toCents(value) {
  const s = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid money value: ${value}`);
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(fracPadded);
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function computeCostPerUnit(purchasePrice, purchaseQuantity) {
  const priceCents = toCents(purchasePrice);
  const qty = Number(purchaseQuantity);
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  const scaled = Math.round((priceCents * 100) / qty);
  const whole = Math.floor(scaled / 10_000);
  const frac = String(scaled % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function computeLineCost(quantity, costPerUnit) {
  const q = Number(quantity);
  const u = Number(costPerUnit);
  if (!Number.isFinite(q) || !Number.isFinite(u) || q <= 0) return "0.00";
  return centsToDecimalString(Math.round(q * u * 100));
}

export function recipeQuantityInPurchaseUnits(recipeQuantity, purchaseUnit) {
  const q = Number(recipeQuantity);
  if (!Number.isFinite(q) || q <= 0) return 0;
  switch (purchaseUnit) {
    case "ml":
    case "g":
    case "piece":
    case "shot":
    case "pump":
      return q;
    case "l":
      return q / 1000;
    case "kg":
      return q / 1000;
    default:
      return q;
  }
}

export function computeRecipeLineCost(recipeQuantity, purchasePrice, purchaseQuantity, purchaseUnit) {
  const qtyInPurchaseUnits = recipeQuantityInPurchaseUnits(recipeQuantity, purchaseUnit);
  const costPerUnit = computeCostPerUnit(purchasePrice, purchaseQuantity);
  return computeLineCost(qtyInPurchaseUnits, costPerUnit);
}

export function sumDecimals(...values) {
  const total = values.reduce((acc, v) => acc + toCents(v), 0);
  return centsToDecimalString(total);
}

export function sumLineCosts(...lines) {
  return sumDecimals(...lines, 0);
}

export function computeOverheadPerCup(monthlyTotal, cupsPerMonth) {
  if (cupsPerMonth <= 0) return null;
  const totalCents = toCents(monthlyTotal);
  return centsToDecimalString(Math.round(totalCents / cupsPerMonth));
}

export function computeTotalCostPerCup(ingredientCost, overheadPerCup) {
  if (overheadPerCup === null) return sumDecimals(ingredientCost, 0);
  return sumDecimals(ingredientCost, overheadPerCup);
}

export function resolveProfitPerCup(itemProfit, defaultProfit) {
  if (itemProfit !== null && itemProfit !== undefined && itemProfit !== "") return itemProfit;
  if (defaultProfit !== null && defaultProfit !== undefined && defaultProfit !== "") return defaultProfit;
  return "0.00";
}

export function computeSellingPriceExact(totalCost, profit) {
  return sumDecimals(totalCost, profit);
}

export function formatSellingPriceDisplay(exact) {
  const cents = toCents(exact);
  const wholeBaht = Math.round(cents / 100);
  return `฿${new Intl.NumberFormat("en-US").format(wholeBaht)}`;
}

/** Keep in sync with lib/break-even.ts */
export function computeProfit(income, expense) {
  return centsToDecimalString(toCents(income) - toCents(expense));
}

export function computeContributionPerCup(sellingPriceExact, ingredientCostPerCup) {
  return computeProfit(sellingPriceExact, ingredientCostPerCup);
}

export function breakEvenNeedsSetup(fixedCostsMonthly) {
  return toCents(fixedCostsMonthly) <= 0;
}

export function computeBreakEvenCups(fixedCostsMonthly, contributionPerCup) {
  const contribCents = toCents(contributionPerCup);
  if (contribCents <= 0) return null;
  return Math.ceil(toCents(fixedCostsMonthly) / contribCents);
}

export function computeBreakEvenItem(
  fixedCostsMonthly,
  ingredientCostPerCup,
  sellingPriceExact,
  estimatedCupsPerMonth,
  needsSetup,
) {
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
  let comparison = null;
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
