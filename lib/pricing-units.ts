import type { PurchaseUnit } from "@/types/pricing";

/**
 * Recipe quantities use a fixed "usage" unit per family:
 * - volume → ml (even when purchased in L)
 * - mass   → g  (even when purchased in kg)
 * - piece / shot / pump → same unit as purchase (no cross-conversion)
 */
export type UnitFamily = "volume" | "mass" | "discrete";

const UNIT_FAMILY: Record<PurchaseUnit, UnitFamily> = {
  ml: "volume",
  l: "volume",
  g: "mass",
  kg: "mass",
  piece: "discrete",
  shot: "discrete",
  pump: "discrete",
};

/** Thai label for the unit shown when entering recipe quantities. */
export const RECIPE_USAGE_UNIT_LABELS: Record<PurchaseUnit, string> = {
  ml: "มล.",
  l: "มล.",
  g: "กรัม",
  kg: "กรัม",
  piece: "ชิ้น",
  shot: "ช็อต",
  pump: "ปั๊ม",
};

export function unitFamily(unit: PurchaseUnit): UnitFamily {
  return UNIT_FAMILY[unit];
}

/**
 * Convert a recipe quantity (in usage units) to the ingredient's purchase unit
 * so it can multiply cost_per_purchase_unit.
 */
export function recipeQuantityInPurchaseUnits(
  recipeQuantity: string | number,
  purchaseUnit: PurchaseUnit,
): number {
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

export function recipeUsageUnitLabel(purchaseUnit: PurchaseUnit): string {
  return RECIPE_USAGE_UNIT_LABELS[purchaseUnit];
}
