import { query } from "@/lib/db";
import { isSubscriptionTier, type PaidSubscriptionTier, type SubscriptionTier } from "@/lib/pricing";

export type UserSubscriptionRow = {
  user_id: string;
  tier: string;
  current_period_end: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

/** Pure: active tier from stored row + clock (exported for tests). */
export function resolveActiveTier(
  tier: string,
  periodEnd: Date | string | null,
  now: Date = new Date(),
): SubscriptionTier {
  if (!periodEnd) return "free";
  const end = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  if (Number.isNaN(end.getTime()) || end <= now) return "free";
  return isSubscriptionTier(tier) ? tier : "free";
}

/** Pure: extend expiry from current end or now (exported for tests). */
export function computeExtendedPeriodEnd(
  currentEnd: Date | string | null,
  days: number,
  now: Date = new Date(),
): Date {
  if (days <= 0) throw new Error("period days must be positive");
  let base = now;
  if (currentEnd) {
    const end = currentEnd instanceof Date ? currentEnd : new Date(currentEnd);
    if (!Number.isNaN(end.getTime()) && end > now) base = end;
  }
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export async function getActiveTier(userId: string, now: Date = new Date()): Promise<SubscriptionTier> {
  const { rows } = await query<Pick<UserSubscriptionRow, "tier" | "current_period_end">>(
    `SELECT tier, current_period_end
     FROM user_subscriptions
     WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return "free";
  return resolveActiveTier(rows[0].tier, rows[0].current_period_end, now);
}

export async function extendPeriod(
  userId: string,
  tier: PaidSubscriptionTier,
  days: number,
  now: Date = new Date(),
): Promise<UserSubscriptionRow> {
  const { rows: existing } = await query<Pick<UserSubscriptionRow, "current_period_end">>(
    `SELECT current_period_end FROM user_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const currentEnd = existing[0]?.current_period_end ?? null;
  const newEnd = computeExtendedPeriodEnd(currentEnd, days, now);

  const { rows } = await query<UserSubscriptionRow>(
    `INSERT INTO user_subscriptions (user_id, tier, current_period_end)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       tier = EXCLUDED.tier,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = now()
     RETURNING user_id, tier, current_period_end, created_at, updated_at`,
    [userId, tier, newEnd.toISOString()],
  );
  return rows[0];
}
