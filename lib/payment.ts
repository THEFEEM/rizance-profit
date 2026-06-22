import type Omise from "omise";
import { query } from "@/lib/db";
import { getOmise } from "@/lib/omise";
import { isPaidSubscriptionTier, type PaidSubscriptionTier } from "@/lib/pricing";
import { extendPeriod } from "@/lib/subscription";

export type PaymentStatus = "pending" | "paid" | "failed" | "expired";

export type PaymentRecord = {
  id: string;
  userId: string;
  tier: string;
  amount: string;
  periodDays: number;
  status: PaymentStatus;
  omiseChargeId: string | null;
  paidAt: string | null;
  createdAt: string;
};

type PaymentRow = {
  id: string;
  user_id: string;
  tier: string;
  amount: string;
  period_days: number;
  status: string;
  omise_charge_id: string | null;
  paid_at: Date | string | null;
  created_at: Date | string;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapPaymentRow(r: PaymentRow): PaymentRecord {
  return {
    id: r.id,
    userId: r.user_id,
    tier: r.tier,
    amount: r.amount,
    periodDays: r.period_days,
    status: r.status as PaymentStatus,
    omiseChargeId: r.omise_charge_id,
    paidAt: r.paid_at ? toIso(r.paid_at) : null,
    createdAt: toIso(r.created_at),
  };
}

export function promptPayQrImageUrl(charge: Omise.Charges.ICharge): string | null {
  return charge.source?.scannable_code?.image?.download_uri ?? null;
}

export async function createPromptPayCharge(input: {
  userId: string;
  tier: PaidSubscriptionTier;
  amountTHB: number;
  periodDays: number;
}): Promise<Omise.Charges.ICharge> {
  const omise = getOmise();
  const amountSatang = input.amountTHB * 100;

  return omise.charges.create({
    amount: amountSatang,
    currency: "thb",
    source: { type: "promptpay", amount: amountSatang, currency: "thb" },
    metadata: {
      userId: input.userId,
      tier: input.tier,
      periodDays: String(input.periodDays),
    },
  });
}

export async function insertPendingPaymentRecord(input: {
  userId: string;
  tier: PaidSubscriptionTier;
  amountTHB: number;
  periodDays: number;
  omiseChargeId: string;
}): Promise<PaymentRecord> {
  const { rows } = await query<PaymentRow>(
    `INSERT INTO payment_records (user_id, tier, amount, period_days, status, omise_charge_id)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, user_id, tier, amount::text AS amount, period_days, status,
               omise_charge_id, paid_at, created_at`,
    [input.userId, input.tier, input.amountTHB, input.periodDays, input.omiseChargeId],
  );
  return mapPaymentRow(rows[0]);
}

export async function findPaymentByChargeId(
  userId: string,
  chargeId: string,
): Promise<PaymentRecord | null> {
  const { rows } = await query<PaymentRow>(
    `SELECT id, user_id, tier, amount::text AS amount, period_days, status,
            omise_charge_id, paid_at, created_at
     FROM payment_records
     WHERE user_id = $1 AND omise_charge_id = $2`,
    [userId, chargeId],
  );
  return rows[0] ? mapPaymentRow(rows[0]) : null;
}

export async function findPaymentRecordByOmiseChargeId(
  chargeId: string,
): Promise<PaymentRecord | null> {
  const { rows } = await query<PaymentRow>(
    `SELECT id, user_id, tier, amount::text AS amount, period_days, status,
            omise_charge_id, paid_at, created_at
     FROM payment_records
     WHERE omise_charge_id = $1`,
    [chargeId],
  );
  return rows[0] ? mapPaymentRow(rows[0]) : null;
}

export type PaidPaymentFlip = {
  userId: string;
  tier: PaidSubscriptionTier;
  periodDays: number;
};

/** Atomic pending → paid flip. Returns row only when this call won the race. */
export async function markPaymentPaidIfPending(
  omiseChargeId: string,
): Promise<PaidPaymentFlip | null> {
  const { rows } = await query<{ user_id: string; tier: string; period_days: number }>(
    `UPDATE payment_records
     SET status = 'paid', paid_at = now()
     WHERE omise_charge_id = $1 AND status = 'pending'
     RETURNING user_id, tier, period_days`,
    [omiseChargeId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!isPaidSubscriptionTier(row.tier)) return null;
  return { userId: row.user_id, tier: row.tier, periodDays: row.period_days };
}

export type FulfillPaidResult = "extended" | "already_paid" | "not_found" | "skipped";

/**
 * Idempotent fulfillment after Omise confirms charge.paid.
 * extendPeriod runs only when the atomic pending→paid UPDATE returns a row.
 */
export async function fulfillPaidPaymentRecord(omiseChargeId: string): Promise<FulfillPaidResult> {
  const record = await findPaymentRecordByOmiseChargeId(omiseChargeId);
  if (!record) return "not_found";
  if (record.status === "paid") return "already_paid";

  const flipped = await markPaymentPaidIfPending(omiseChargeId);
  if (!flipped) {
    const again = await findPaymentRecordByOmiseChargeId(omiseChargeId);
    if (again?.status === "paid") return "already_paid";
    return "skipped";
  }

  await extendPeriod(flipped.userId, flipped.tier, flipped.periodDays);
  return "extended";
}

const CHARGE_WEBHOOK_KEYS = new Set(["charge.complete", "charge.capture"]);

type OmiseWebhookEvent = {
  object?: string;
  key?: string;
  data?: { object?: string; id?: string };
};

/** Extract charge id from Omise webhook event body (charge.complete, etc.). */
export function parseChargeIdFromOmiseWebhook(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const event = body as OmiseWebhookEvent;
  if (event.object !== "event") return null;
  if (event.key && !CHARGE_WEBHOOK_KEYS.has(event.key)) return null;
  const data = event.data;
  if (!data || data.object !== "charge" || typeof data.id !== "string") return null;
  return data.id;
}
