import { query } from "@/lib/db";
import type { PlanCheckResult } from "@/lib/plan-check";
import { resolveActivePlan, type SubscriptionPlan } from "@/lib/subscription-plan";
import {
  getTokenBudgetSummary,
  resolveTokenScope,
  type AppContextMode,
  type TokenBudgetCheckResult,
  type TokenBudgetSummary,
} from "@/lib/token-budget";
import { NextResponse } from "next/server";

import "server-only";

export type { TokenBudgetSummary };
export { getTokenBudgetSummary, resolveTokenScope };

type SubscriptionRow = {
  subscription_plan: string;
  subscription_expires_at: string | null;
  stripe_subscription_id: string | null;
};

export async function getActiveSubscriptionPlan(userId: string): Promise<SubscriptionPlan> {
  const { rows } = await query<SubscriptionRow>(
    `SELECT subscription_plan, subscription_expires_at, stripe_subscription_id
     FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return "free";
  return resolveActivePlan(row.subscription_plan, row.subscription_expires_at);
}

export async function getSubscriptionStatus(userId: string) {
  const { rows } = await query<SubscriptionRow>(
    `SELECT subscription_plan, subscription_expires_at, stripe_subscription_id
     FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  const storedPlan = row?.subscription_plan ?? "free";
  const expiresAt = row?.subscription_expires_at ?? null;
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  const plan = resolveActivePlan(storedPlan, expiresAt);

  return {
    plan,
    storedPlan,
    expiresAt,
    isExpired,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
  };
}

export function quotaExceededResponse(
  planCheck: Extract<PlanCheckResult, { allowed: false }>,
) {
  return NextResponse.json(
    {
      error: {
        code: "quota_exceeded",
        message: planCheck.upgradeMessage,
        limit: planCheck.limit,
        used: planCheck.used,
      },
    },
    { status: 429 },
  );
}

export function tokenQuotaExceededResponse(
  check: Extract<TokenBudgetCheckResult, { allowed: false }>,
) {
  return NextResponse.json(
    {
      error: {
        code: "quota_exceeded",
        message: check.upgradeMessage,
        used: check.tokensUsed,
        total: check.tokensTotal,
      },
    },
    { status: 429 },
  );
}

export async function getTokenBudgetForContext(
  userId: string,
  mode: AppContextMode,
  plan: SubscriptionPlan,
  boothId?: string,
): Promise<TokenBudgetSummary> {
  const scope = resolveTokenScope(mode, plan, boothId);
  return getTokenBudgetSummary(userId, scope);
}
