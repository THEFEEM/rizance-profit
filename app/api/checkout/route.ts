import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
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

const CHECKOUT_USER_MESSAGE = "ไม่สามารถดำเนินการชำระเงินได้ กรุณาลองใหม่อีกครั้ง";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function isMissingStripeCustomer(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "resource_missing" &&
    (error.param === "customer" || /No such customer/i.test(error.message ?? ""))
  );
}

function checkoutSessionParams(
  customerId: string,
  user: CheckoutUserRow,
  plan: PaidStripePlan,
): Stripe.Checkout.SessionCreateParams {
  const config = PLAN_CONFIG[plan];
  return {
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
  };
}

async function createCheckoutSessionWithCustomerRecovery(
  customerId: string,
  user: CheckoutUserRow,
  plan: PaidStripePlan,
): Promise<Stripe.Checkout.Session> {
  try {
    return await stripe.checkout.sessions.create(checkoutSessionParams(customerId, user, plan));
  } catch (error) {
    if (!isMissingStripeCustomer(error)) throw error;

    console.error("[checkout] Stripe customer missing, recreating:", error);

    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customer.id, user.id]);

    return await stripe.checkout.sessions.create(checkoutSessionParams(customer.id, user, plan));
  }
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

  try {
    const session = await createCheckoutSessionWithCustomerRecovery(
      customerId,
      user,
      plan as PaidStripePlan,
    );

    if (!session.url) {
      return NextResponse.json(
        { error: { message: CHECKOUT_USER_MESSAGE } },
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
    console.error("[checkout] Stripe checkout session failed:", error);
    return NextResponse.json({ error: { message: CHECKOUT_USER_MESSAGE } }, { status: 502 });
  }
}
