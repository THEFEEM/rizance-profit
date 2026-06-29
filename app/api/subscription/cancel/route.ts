import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getUserId } from "@/lib/session";

type SubscriptionIdRow = {
  stripe_subscription_id: string | null;
};

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { rows } = await query<SubscriptionIdRow>(
    `SELECT stripe_subscription_id FROM users WHERE id = $1`,
    [userId],
  );

  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) {
    return NextResponse.json({ error: { message: "ไม่มี subscription" } }, { status: 400 });
  }

  await stripe.subscriptions.update(subId, {
    cancel_at_period_end: true,
  });

  return NextResponse.json({ data: { ok: true } });
}
