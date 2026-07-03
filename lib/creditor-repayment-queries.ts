import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";
import { isUndefinedColumnError } from "@/lib/db-migration-guard";
import { today } from "@/lib/date";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import { computeShopOnHand } from "@/lib/shop-on-hand";
import type { CreditorRepaymentInput } from "@/lib/creditor-validation";
import {
  lockShopUser,
  ShopOnHandInsufficientError,
} from "@/lib/shop-profit-withdrawal-queries";
import type { CreditorRepayment } from "@/types/shop";

export type CreditorRepaymentRow = {
  id: string;
  user_id: string;
  payer_kind: string;
  payer_name: string;
  amount: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

export function mapCreditorRepayment(r: CreditorRepaymentRow): CreditorRepayment {
  return {
    id: r.id,
    userId: r.user_id,
    payerKind: r.payer_kind as CreditorRepayment["payerKind"],
    payerName: r.payer_name,
    amount: r.amount,
    paymentMethod: r.payment_method as CreditorRepayment["paymentMethod"],
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

const REPAYMENT_RETURN = `id, user_id, payer_kind, payer_name, amount, payment_method, note,
  entry_date::text AS entry_date, created_at`;

function repaymentQuery<T extends Record<string, unknown>>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[],
) {
  return client ? client.query<T>(text, params as never[]) : pool.query<T>(text, params);
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function isMissingRelationError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "42P01"
  );
}

export class RepaymentExceedsOwedError extends Error {
  constructor(public maxAmount: string) {
    super("creditor repayment exceeds remaining owed");
    this.name = "RepaymentExceedsOwedError";
  }
}

export function repaymentExceedsOwedMessage(maxAmount: string, currency = "THB"): string {
  return `คืนได้ไม่เกิน ${formatMoney(maxAmount, currency)}`;
}

/** All-time creditor repayment totals by payment method — for on-hand balance. */
export async function allTimeRepaymentsByMethod(
  userId: string,
  client?: PoolClient,
): Promise<{ cashRepayments: string; transferRepayments: string }> {
  try {
    const { rows } = await repaymentQuery<{
      cash_repayments: string;
      transfer_repayments: string;
    }>(
      client,
      `SELECT
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)::text AS cash_repayments,
         COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0)::text AS transfer_repayments
       FROM creditor_repayments
       WHERE user_id = $1 AND booth_id IS NULL`,
      [userId],
    );
    const r = rows[0];
    return {
      cashRepayments: r.cash_repayments,
      transferRepayments: r.transfer_repayments,
    };
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) {
      return { cashRepayments: "0.00", transferRepayments: "0.00" };
    }
    throw err;
  }
}

/** Repayment totals grouped by creditor (payer_kind + payer_name). */
export async function listRepaymentsByCreditor(
  userId: string,
): Promise<{ payerKind: string; name: string; repaid: string }[]> {
  try {
    const { rows } = await query<{ payer_kind: string; name: string; repaid: string }>(
      `SELECT payer_kind, payer_name AS name, COALESCE(SUM(amount), 0)::text AS repaid
       FROM creditor_repayments
       WHERE user_id = $1 AND booth_id IS NULL
       GROUP BY payer_kind, payer_name`,
      [userId],
    );
    return rows.map((r) => ({ payerKind: r.payer_kind, name: r.name, repaid: r.repaid }));
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return [];
    throw err;
  }
}

async function sumRepaidByCreditor(
  userId: string,
  payerKind: string,
  payerName: string,
  client: PoolClient,
): Promise<string> {
  const { rows } = await client.query<{ repaid: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS repaid
     FROM creditor_repayments
     WHERE user_id = $1 AND booth_id IS NULL AND payer_kind = $2 AND payer_name = $3`,
    [userId, payerKind, payerName],
  );
  return rows[0].repaid;
}

export async function createCreditorRepayment(
  userId: string,
  input: CreditorRepaymentInput,
  owedAmount: string,
): Promise<CreditorRepayment> {
  const entryDate = input.entryDate ?? today();
  const amount = input.amount.toFixed(2);
  const paymentMethod = input.paymentMethod;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockShopUser(client, userId);

    const repaid = await sumRepaidByCreditor(
      userId,
      input.payerKind,
      input.payerName,
      client,
    );
    const availableCents = toCents(owedAmount) - toCents(repaid);
    if (toCents(amount) > availableCents) {
      throw new RepaymentExceedsOwedError(
        centsToDecimalString(Math.max(0, availableCents)),
      );
    }

    const onHand = await computeShopOnHand(userId, client);
    const methodOnHand =
      paymentMethod === "cash" ? onHand.cashOnHand : onHand.transferOnHand;
    if (toCents(amount) > toCents(methodOnHand)) {
      throw new ShopOnHandInsufficientError(paymentMethod, methodOnHand);
    }

    const { rows } = await client.query<CreditorRepaymentRow>(
      `INSERT INTO creditor_repayments
         (user_id, booth_id, payer_kind, payer_name, amount, payment_method, note, entry_date)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::date)
       RETURNING ${REPAYMENT_RETURN}`,
      [
        userId,
        input.payerKind,
        input.payerName,
        amount,
        paymentMethod,
        input.note ?? null,
        entryDate,
      ],
    );

    await client.query("COMMIT");
    return mapCreditorRepayment(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
