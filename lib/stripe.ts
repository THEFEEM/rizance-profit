import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

let stripeClient: Stripe | null = null;

function requireStripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return key;
}

/** Lazily initialized Stripe client — keys read from env at runtime only. */
export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(requireStripeKey(), { apiVersion: STRIPE_API_VERSION });
  }
  return stripeClient;
}

/** Stripe SDK — initialized on first property access at runtime. */
export const stripe = {
  get customers() {
    return getStripe().customers;
  },
  get checkout() {
    return getStripe().checkout;
  },
  get webhooks() {
    return getStripe().webhooks;
  },
  get subscriptions() {
    return getStripe().subscriptions;
  },
};
