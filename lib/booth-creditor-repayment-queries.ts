import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { isUndefinedColumnError } from "@/lib/db-migration-guard";
import { today } from "@/lib/date";
import { computeBoothCashOnHand } from "@/lib/booth-cash-on-hand";
import { getBooth } from "@/lib/booth-queries";
import type { CreditorRepaymentInput } from "@/lib/creditor-validation";
import {
  RepaymentExceedsOwedError,
  type CreditorRepaymentRow,
  mapCreditorRepayment,
} from "@/lib/creditor-repayment-queries";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import type { CreditorRepayment } from "@/types/shop";

const REPAYMENT_NOTE = "จ่ายคืนเจ้าหนี้";

export class BoothCashInsufficientError extends Error {
  constructor(public available: string) {
    super("booth cash insufficient");
    this.name = "BoothCashInsufficientError";
  }
}

export function boothCashInsufficientMessage(available: string, currency = "THB"): string {
  return `เงินคงเหลือไม่พอ (มี ${formatMoney(available, currency)})`;
}

async function sumBoothRepaidByCreditor(
  userId: string,
  boothId: string,
  payerKind: string,
  payerName: string,
  client: PoolClient,
): Promise<string> {
  const { rows } = await client.query<{ repaid: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS repaid
     FROM creditor_repayments
     WHERE user_id = $1 AND booth_id = $2 AND payer_kind = $3 AND payer_name = $4`,
    [userId, boothId, payerKind, payerName],
  );
  return rows[0].repaid;
}

export async function createBoothCreditorRepayment(
  userId: string,
  boothId: string,
  input: CreditorRepaymentInput,
  owedAmount: string,
): Promise<CreditorRepayment> {
  const booth = await getBooth(userId, boothId);
  if (!booth) throw new Error("booth not found");

  const entryDate = input.entryDate ?? today();
  const amount = input.amount.toFixed(2);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const repaid = await sumBoothRepaidByCreditor(
      userId,
      boothId,
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

    const cashOnHand = await computeBoothCashOnHand(userId, boothId);
    if (toCents(amount) > toCents(cashOnHand)) {
      throw new BoothCashInsufficientError(cashOnHand);
    }

    const note = input.note?.trim()
      ? `${REPAYMENT_NOTE} · ${input.note.trim()}`
      : REPAYMENT_NOTE;

    const { rows } = await client.query<CreditorRepaymentRow>(
      `INSERT INTO creditor_repayments
         (user_id, booth_id, payer_kind, payer_name, amount, payment_method, note, entry_date)
       VALUES ($1, $2, $3, $4, $5, 'cash', $6, $7::date)
       RETURNING id, user_id, payer_kind, payer_name, amount, payment_method, note,
         entry_date::text AS entry_date, created_at`,
      [
        userId,
        boothId,
        input.payerKind,
        input.payerName,
        amount,
        note,
        entryDate,
      ],
    );

    await client.query(
      `INSERT INTO booth_expense_entries
         (booth_id, user_id, amount, cost_type, category, label, note, entry_date)
       VALUES ($1, $2, $3, 'variable', 'expense_misc', $4, $5, $6::date)`,
      [
        boothId,
        userId,
        amount,
        `จ่ายคืน ${input.payerName}`,
        note,
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

export async function listBoothRepaymentsByCreditor(
  userId: string,
  boothId: string,
): Promise<{ payerKind: string; name: string; repaid: string }[]> {
  try {
    const { rows } = await pool.query<{ payer_kind: string; name: string; repaid: string }>(
      `SELECT payer_kind, payer_name AS name, COALESCE(SUM(amount), 0)::text AS repaid
       FROM creditor_repayments
       WHERE user_id = $1 AND booth_id = $2
       GROUP BY payer_kind, payer_name`,
      [userId, boothId],
    );
    return rows.map((r) => ({ payerKind: r.payer_kind, name: r.name, repaid: r.repaid }));
  } catch (err) {
    if (isUndefinedColumnError(err)) return [];
    throw err;
  }
}
