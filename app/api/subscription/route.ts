import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { resolveActivePlan } from "@/lib/subscription-plan";
import {
  getActiveSubscriptionPlan,
  getTokenBudgetForContext,
} from "@/lib/subscription-user";
import { getUserId } from "@/lib/session";

type SubscriptionRow = {
  subscription_plan: string;
  subscription_expires_at: string | null;
};

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { rows } = await query<SubscriptionRow>(
    `SELECT subscription_plan, subscription_expires_at FROM users WHERE id = $1`,
    [userId],
  );

  const storedPlan = rows[0]?.subscription_plan ?? "free";
  const expiresAt = rows[0]?.subscription_expires_at ?? null;
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  const plan = resolveActivePlan(storedPlan, expiresAt);

  const rawContext = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const ctx = await resolveTodayContext(userId, undefined, rawContext);
  const activePlan = await getActiveSubscriptionPlan(userId);
  const tokenBudget = await getTokenBudgetForContext(
    userId,
    ctx.mode,
    activePlan,
    ctx.mode === "booth" ? ctx.boothId : undefined,
  );

  return NextResponse.json({
    data: {
      plan,
      expiresAt,
      isExpired,
      tokenBudget,
    },
  });
}
