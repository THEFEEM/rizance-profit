import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import {
  isPaidStripePlan,
  PLAN_CONFIG,
  planAmountSatang,
  planExpiresAt,
  type PaidStripePlan,
} from "@/lib/subscription-plan";
import { stripe } from "@/lib/stripe";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

type CheckoutUserRow = {
  id: string;
  email: string;
  stripe_customer_id: string | null;
};

const bodySchema = z.object({
  plan: z.string().min(1),
});

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const { plan } = parsed.data;
  if (!isPaidStripePlan(plan)) {
    return NextResponse.json({ error: { message: "Invalid plan" } }, { status: 400 });
  }

  const { rows } = await query<CheckoutUserRow>(
    `SELECT id, email, stripe_customer_id FROM users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customerId, user.id]);
  }

  const config = PLAN_CONFIG[plan as PaidStripePlan];
  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: config.mode,
      line_items: [
        {
          price_data: {
            currency: "thb",
            product_data: { name: config.label },
            unit_amount: config.amount,
            ...(config.interval ? { recurring: { interval: config.interval } } : {}),
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl()}/pricing?success=true`,
      cancel_url: `${appUrl()}/pricing?canceled=true`,
      metadata: {
        userId: user.id,
        plan,
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: { message: "Stripe did not return a checkout URL" } },
        { status: 502 },
      );
    }

    const expiresAt = planExpiresAt(plan);
    await query(
      `INSERT INTO stripe_payments (user_id, stripe_session_id, plan, amount, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, session.id, plan, planAmountSatang(plan), expiresAt.toISOString()],
    );

    return NextResponse.json({ data: { url: session.url } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stripe checkout session failed";
    return NextResponse.json({ error: { message } }, { status: 502 });
  }
}
