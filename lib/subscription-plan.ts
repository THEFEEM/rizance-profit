export const PAID_STRIPE_PLANS = ["event_pass", "business"] as const;

export type PaidStripePlan = (typeof PAID_STRIPE_PLANS)[number];

export type SubscriptionPlan = "free" | PaidStripePlan;

export function isPaidStripePlan(value: string): value is PaidStripePlan {
  return (PAID_STRIPE_PLANS as readonly string[]).includes(value);
}

export function resolveActivePlan(
  plan: string,
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): SubscriptionPlan {
  if (!expiresAt) return plan === "free" ? "free" : "free";
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(end.getTime()) || end <= now) return "free";
  if (plan === "event_pass" || plan === "business") return plan;
  return "free";
}

export function planExpiresAt(plan: PaidStripePlan, from: Date = new Date()): Date {
  const days = plan === "event_pass" ? 7 : 30;
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}

export function planAmountSatang(plan: PaidStripePlan): number {
  return plan === "event_pass" ? 4900 : 9900;
}
