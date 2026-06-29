import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveActivePlan } from "@/lib/subscription-plan";
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

  return NextResponse.json({
    data: {
      plan,
      expiresAt,
      isExpired,
    },
  });
}
