/** Paid subscription tiers (prices here — not in DB). */

export const SUBSCRIPTION_TIERS = [
  "free",
  "event_pass",
  "business",
  "business_pro",
  "org_lite",
  "org_pro",
] as const;

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export type PaidSubscriptionTier = Exclude<SubscriptionTier, "free">;

export type SubscriptionPlan = {
  tier: PaidSubscriptionTier;
  periodDays: number;
  priceBaht: number;
  label: string;
};

/** Sellable plans — org_pro has monthly + annual SKUs. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  { tier: "event_pass", periodDays: 7, priceBaht: 39, label: "Event Pass (7 วัน)" },
  { tier: "business", periodDays: 30, priceBaht: 59, label: "Business (1 เดือน)" },
  { tier: "business_pro", periodDays: 30, priceBaht: 99, label: "Business Pro (1 เดือน)" },
  { tier: "org_lite", periodDays: 30, priceBaht: 199, label: "Org Lite (1 เดือน)" },
  { tier: "org_pro", periodDays: 30, priceBaht: 399, label: "Org Pro (1 เดือน)" },
  { tier: "org_pro", periodDays: 365, priceBaht: 3990, label: "Org Pro (1 ปี)" },
] as const;

const TIER_SET = new Set<string>(SUBSCRIPTION_TIERS);

export function isSubscriptionTier(value: string): value is SubscriptionTier {
  return TIER_SET.has(value);
}

export function findPlan(tier: PaidSubscriptionTier, periodDays: number): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.tier === tier && p.periodDays === periodDays);
}

export type SubscriptionCycle = "period" | "year";

export type TierPlan = {
  amountTHB: number;
  periodDays: number;
};

export function isPaidSubscriptionTier(tier: string): tier is PaidSubscriptionTier {
  return isSubscriptionTier(tier) && tier !== "free";
}

/** Server-side price map — never trust client-supplied amounts. */
export function getTierPlan(tier: string, cycle: SubscriptionCycle = "period"): TierPlan {
  if (!isPaidSubscriptionTier(tier)) {
    throw new Error(`Invalid subscription tier: ${tier}`);
  }

  if (cycle === "year") {
    if (tier !== "org_pro") {
      throw new Error(`Annual billing not available for tier: ${tier}`);
    }
    const annual = findPlan("org_pro", 365);
    if (!annual) throw new Error(`No annual plan for tier: ${tier}`);
    return { amountTHB: annual.priceBaht, periodDays: annual.periodDays };
  }

  const monthly = SUBSCRIPTION_PLANS.find((p) => p.tier === tier && p.periodDays !== 365);
  if (!monthly) throw new Error(`Invalid subscription tier: ${tier}`);
  return { amountTHB: monthly.priceBaht, periodDays: monthly.periodDays };
}

export function planLabel(tier: PaidSubscriptionTier, periodDays: number): string {
  return findPlan(tier, periodDays)?.label ?? tier;
}
