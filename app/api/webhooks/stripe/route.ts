import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { pool } from "@/lib/db";
import { isPaidStripePlan, planExpiresAt, type PaidStripePlan } from "@/lib/subscription-plan";
import { stripe } from "@/lib/stripe";

function sessionSubscriptionId(
  subscription: Stripe.Checkout.Session["subscription"],
): string | null {
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function sessionPlan(metadata: Stripe.Metadata | null): PaidStripePlan | null {
  const plan = metadata?.plan;
  if (plan && isPaidStripePlan(plan)) return plan;
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: { message: "Missing stripe-signature" } }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: { message: "STRIPE_WEBHOOK_SECRET is not configured" } },
      { status: 500 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: { message: "Invalid signature" } }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = sessionPlan(session.metadata);
      if (!userId || !plan) break;

      const expiresAt = planExpiresAt(plan);
      const subscriptionId = sessionSubscriptionId(session.subscription);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE users SET
             subscription_plan = $1,
             subscription_expires_at = $2,
             stripe_subscription_id = $3
           WHERE id = $4`,
          [plan, expiresAt.toISOString(), subscriptionId, userId],
        );
        await client.query(
          `UPDATE stripe_payments
           SET status = 'completed', expires_at = $1
           WHERE stripe_session_id = $2`,
          [expiresAt.toISOString(), session.id],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;

      const { rows } = await pool.query<{ subscription_plan: string }>(
        `SELECT subscription_plan FROM users WHERE stripe_customer_id = $1`,
        [customerId],
      );
      const storedPlan = rows[0]?.subscription_plan;
      if (!storedPlan || !isPaidStripePlan(storedPlan) || storedPlan === "event_pass") break;

      const newExpires = planExpiresAt(storedPlan);
      await pool.query(
        `UPDATE users SET subscription_expires_at = $1 WHERE stripe_customer_id = $2`,
        [newExpires.toISOString(), customerId],
      );
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (!customerId) break;

      await pool.query(
        `UPDATE users SET
           subscription_plan = 'free',
           subscription_expires_at = NULL,
           stripe_subscription_id = NULL
         WHERE stripe_customer_id = $1`,
        [customerId],
      );
      break;
    }
  }

  return NextResponse.json({ received: true });
}
