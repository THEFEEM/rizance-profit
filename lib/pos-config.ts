/** Comma-separated plan slugs allowed to use POS (e.g. business or business,business_pro). */
const DEFAULT_POS_ALLOWED_PLANS = "business";

export function getPosAllowedPlans(): string[] {
  const raw = process.env.POS_ALLOWED_PLANS?.trim() || DEFAULT_POS_ALLOWED_PLANS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isPosPlanAllowed(plan: string): boolean {
  return getPosAllowedPlans().includes(plan);
}
