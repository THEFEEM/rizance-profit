import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { computeShopOnHand } from "@/lib/shop-on-hand";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import type { ProfitWithdrawalInput } from "@/lib/shop-validation";
import type { ProfitWithdrawal } from "@/types/shop";
import type { PaymentMethod } from "@/types/booth";

type ProfitWithdrawalRow = {
  id: string;
  user_id: string;
  member_id: string;
  amount: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

const WITHDRAWAL_RETURN = `id, user_id, member_id, amount, payment_method, note,
  entry_date::text AS entry_date, created_at`;

function withdrawalQuery<T extends Record<string, unknown>>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[],
) {
  return client ? client.query<T>(text, params as never[]) : pool.query<T>(text, params);
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapProfitWithdrawal(r: ProfitWithdrawalRow): ProfitWithdrawal {
  return {
    id: r.id,
    userId: r.user_id,
    memberId: r.member_id,
    amount: r.amount,
    paymentMethod: r.payment_method as ProfitWithdrawal["paymentMethod"],
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

export class ProfitWithdrawalLimitError extends Error {
  constructor(public maxAmount: string) {
    super("profit withdrawal exceeds available share");
    this.name = "ProfitWithdrawalLimitError";
  }
}

export class ShopOnHandInsufficientError extends Error {
  constructor(
    public paymentMethod: PaymentMethod,
    public maxAmount: string,
  ) {
    super("shop on-hand insufficient for withdrawal");
    this.name = "ShopOnHandInsufficientError";
  }
}

export function profitWithdrawalLimitMessage(maxAmount: string, currency = "THB"): string {
  return `ถอนได้ไม่เกิน ${formatMoney(maxAmount, currency)}`;
}

export function shopOnHandInsufficientMessage(paymentMethod: PaymentMethod): string {
  return paymentMethod === "cash" ? "เงินสดไม่พอ" : "เงินโอนไม่พอ";
}

export async function lockShopUser(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new Error("User not found");
}

async function assertMemberOwned(
  client: PoolClient,
  userId: string,
  memberId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM shop_members WHERE id = $2 AND user_id = $1 FOR UPDATE`,
    [userId, memberId],
  );
  if (!rows[0]) throw new Error("Member not found");
}

/** All-time profit withdrawal totals by payment method — for on-hand balance. */
export async function allTimeProfitWithdrawalsByMethod(
  userId: string,
  client?: PoolClient,
): Promise<{ cashWithdrawals: string; transferWithdrawals: string }> {
  const { rows } = await withdrawalQuery<{
    cash_withdrawals: string;
    transfer_withdrawals: string;
  }>(
    client,
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)::text AS cash_withdrawals,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0)::text AS transfer_withdrawals
     FROM profit_withdrawals
     WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    cashWithdrawals: r.cash_withdrawals,
    transferWithdrawals: r.transfer_withdrawals,
  };
}

export async function sumWithdrawnByMember(
  userId: string,
  memberId: string,
  client?: PoolClient,
): Promise<string> {
  const { rows } = await withdrawalQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM profit_withdrawals
     WHERE user_id = $1 AND member_id = $2`,
    [userId, memberId],
  );
  return rows[0]?.total ?? "0.00";
}

export async function sumWithdrawnByMembers(
  userId: string,
): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ member_id: string; total: string }>(
    `SELECT member_id, COALESCE(SUM(amount), 0)::text AS total
     FROM profit_withdrawals
     WHERE user_id = $1
     GROUP BY member_id`,
    [userId],
  );
  return new Map(rows.map((r) => [r.member_id, r.total]));
}

export async function createProfitWithdrawal(
  userId: string,
  input: ProfitWithdrawalInput,
  accumulatedShare: string,
): Promise<ProfitWithdrawal> {
  const entryDate = input.entryDate ?? today();
  const amount = input.amount.toFixed(2);
  const paymentMethod = input.paymentMethod;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockShopUser(client, userId);
    await assertMemberOwned(client, userId, input.memberId);

    const withdrawn = await sumWithdrawnByMember(userId, input.memberId, client);
    const availableCents = toCents(accumulatedShare) - toCents(withdrawn);
    if (toCents(amount) > availableCents) {
      throw new ProfitWithdrawalLimitError(
        centsToDecimalString(Math.max(0, availableCents)),
      );
    }

    const onHand = await computeShopOnHand(userId, client);
    const methodOnHand =
      paymentMethod === "cash" ? onHand.cashOnHand : onHand.transferOnHand;
    if (toCents(amount) > toCents(methodOnHand)) {
      throw new ShopOnHandInsufficientError(paymentMethod, methodOnHand);
    }

    const { rows } = await client.query<ProfitWithdrawalRow>(
      `INSERT INTO profit_withdrawals (user_id, member_id, amount, payment_method, note, entry_date)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING ${WITHDRAWAL_RETURN}`,
      [userId, input.memberId, amount, paymentMethod, input.note ?? null, entryDate],
    );

    await client.query("COMMIT");
    return mapProfitWithdrawal(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listProfitWithdrawalsByMember(
  userId: string,
  memberId: string,
): Promise<ProfitWithdrawal[]> {
  const { rows } = await pool.query<ProfitWithdrawalRow>(
    `SELECT ${WITHDRAWAL_RETURN}
     FROM profit_withdrawals
     WHERE user_id = $1 AND member_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, memberId],
  );
  return rows.map(mapProfitWithdrawal);
}
