import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";

/** cost_per_unit = purchase_price / purchase_quantity (up to 4 decimal places). */
export function computeCostPerUnit(purchasePrice: string | number, purchaseQuantity: string | number): string {
  const priceCents = toCents(purchasePrice);
  const qty = Number(purchaseQuantity);
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  const scaled = Math.round((priceCents * 100) / qty);
  const whole = Math.floor(scaled / 10_000);
  const frac = String(scaled % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** line_cost = quantity × cost_per_unit (2-decimal money). */
export function computeLineCost(quantity: string | number, costPerUnit: string | number): string {
  const q = Number(quantity);
  const u = Number(costPerUnit);
  if (!Number.isFinite(q) || !Number.isFinite(u) || q <= 0) return "0.00";
  return centsToDecimalString(Math.round(q * u * 100));
}

export function sumLineCosts(...lines: (string | number)[]): string {
  return sumDecimals(...lines, 0);
}

export function computeOverheadPerCup(monthlyTotal: string | number, cupsPerMonth: number): string | null {
  if (cupsPerMonth <= 0) return null;
  const totalCents = toCents(monthlyTotal);
  return centsToDecimalString(Math.round(totalCents / cupsPerMonth));
}

export function computeTotalCostPerCup(ingredientCost: string | number, overheadPerCup: string | number | null): string {
  if (overheadPerCup === null) return sumDecimals(ingredientCost, 0);
  return sumDecimals(ingredientCost, overheadPerCup);
}

export function resolveProfitPerCup(
  itemProfit: string | null | undefined,
  defaultProfit: string | null | undefined,
): string {
  if (itemProfit !== null && itemProfit !== undefined && itemProfit !== "") return itemProfit;
  if (defaultProfit !== null && defaultProfit !== undefined && defaultProfit !== "") return defaultProfit;
  return "0.00";
}

export function computeSellingPriceExact(totalCost: string | number, profit: string | number): string {
  return sumDecimals(totalCost, profit);
}

/** Display only: round to whole baht. */
export function formatSellingPriceDisplay(exact: string | number): string {
  const cents = toCents(exact);
  const wholeBaht = Math.round(cents / 100);
  return `฿${new Intl.NumberFormat("en-US").format(wholeBaht)}`;
}
