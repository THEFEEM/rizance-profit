export const PAID_STRIPE_PLANS = ["event_pass", "business", "personal_plus"] as const;

export type PaidStripePlan = (typeof PAID_STRIPE_PLANS)[number];

export type SubscriptionPlan = "free" | PaidStripePlan;

export const PLAN_CONFIG: Record<
  PaidStripePlan,
  {
    mode: "payment" | "subscription";
    amount: number;
    interval?: "month";
    expiryDays: number;
    label: string;
  }
> = {
  event_pass: {
    mode: "payment",
    amount: 4900,
    expiryDays: 7,
    label: "Rizance Event Pass (7 วัน)",
  },
  business: {
    mode: "subscription",
    amount: 9900,
    interval: "month",
    expiryDays: 30,
    label: "Rizance Business (รายเดือน)",
  },
  personal_plus: {
    mode: "subscription",
    amount: 4900,
    interval: "month",
    expiryDays: 30,
    label: "Rizance Personal Plus (รายเดือน)",
  },
};

export function isPaidStripePlan(value: string): value is PaidStripePlan {
  return (PAID_STRIPE_PLANS as readonly string[]).includes(value);
}

export function isSubscriptionPlan(value: string): value is SubscriptionPlan {
  return value === "free" || isPaidStripePlan(value);
}

export function resolveActivePlan(
  plan: string,
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): SubscriptionPlan {
  if (!expiresAt) return plan === "free" ? "free" : "free";
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(end.getTime()) || end <= now) return "free";
  if (isPaidStripePlan(plan)) return plan;
  return "free";
}

export function planExpiresAt(plan: PaidStripePlan, from: Date = new Date()): Date {
  const days = PLAN_CONFIG[plan].expiryDays;
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}

export function planAmountSatang(plan: PaidStripePlan): number {
  return PLAN_CONFIG[plan].amount;
}

export const PLAN_DISPLAY_NAMES: Record<SubscriptionPlan, string> = {
  free: "ฟรี",
  personal_plus: "Personal Plus",
  event_pass: "Event Pass",
  business: "Business",
};
