import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { formatMoney, toCents } from "@/lib/money";
import { postCapitalJournal } from "@/lib/shop-capital-posting-adapter";
import type { CapitalTxInput } from "@/lib/shop-validation";
import type { CapitalTransaction, ShopMember } from "@/types/shop";

type ShopMemberRow = {
  id: string;
  user_id: string;
  name: string;
  role: string;
  investment_amount: string;
  created_at: Date | string;
};

function mapShopMemberRow(r: ShopMemberRow): ShopMember {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    role: r.role as ShopMember["role"],
    investmentAmount: r.investment_amount,
    createdAt: toIso(r.created_at),
  };
}

const MEMBER_RETURN = `id, user_id, name, role, investment_amount::text AS investment_amount, created_at`;

type CapitalTxRow = {
  id: string;
  user_id: string;
  member_id: string;
  amount: string;
  direction: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
  created_at: Date | string;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapCapitalTx(r: CapitalTxRow): CapitalTransaction {
  return {
    id: r.id,
    userId: r.user_id,
    memberId: r.member_id,
    amount: r.amount,
    direction: r.direction as CapitalTransaction["direction"],
    note: r.note,
    entryDate: r.entry_date,
    createdAt: toIso(r.created_at),
  };
}

const CAPITAL_TX_RETURN = `id, user_id, member_id, amount, direction, payment_method, note,
  entry_date::text AS entry_date, created_at`;

const LEDGER_EQUITY_SQL = `
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'contribution' THEN amount ELSE -amount END
  ), 0)::text AS equity
  FROM capital_transactions
  WHERE member_id = $1 AND user_id = $2`;

const SYNC_INVESTMENT_SQL = `
  UPDATE shop_members SET investment_amount = (
    SELECT COALESCE(SUM(
      CASE WHEN direction = 'contribution' THEN amount ELSE -amount END
    ), 0)
    FROM capital_transactions
    WHERE member_id = $2 AND user_id = $1
  )
  WHERE id = $2 AND user_id = $1`;

export class CapitalWithdrawalLimitError extends Error {
  constructor(public maxAmount: string) {
    super("withdrawal exceeds equity");
    this.name = "CapitalWithdrawalLimitError";
  }
}

export function withdrawalLimitMessage(maxAmount: string, currency = "THB"): string {
  return `ถอนได้ไม่เกิน ${formatMoney(maxAmount, currency)}`;
}

async function getMemberName(
  client: PoolClient,
  userId: string,
  memberId: string,
): Promise<string | undefined> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM shop_members WHERE id = $2 AND user_id = $1`,
    [userId, memberId],
  );
  return rows[0]?.name;
}

async function postCapitalJournalForRow(
  client: PoolClient,
  row: CapitalTxRow,
  memberName?: string,
): Promise<void> {
  const paymentMethod = row.payment_method;
  if (paymentMethod !== "cash" && paymentMethod !== "transfer") {
    throw new Error(`unexpected capital_transactions.payment_method: ${paymentMethod}`);
  }

  await postCapitalJournal(client, {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    direction: row.direction as CapitalTransaction["direction"],
    paymentMethod,
    entryDate: row.entry_date,
    memberName,
  });
}

async function assertMemberOwned(
  client: PoolClient,
  userId: string,
  memberId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM shop_members WHERE id = $2 AND user_id = $1`,
    [userId, memberId],
  );
  if (!rows[0]) throw new Error("Member not found");
}

export async function memberEquityFromLedger(
  userId: string,
  memberId: string,
  client?: PoolClient,
): Promise<string> {
  const q = client ?? pool;
  const { rows } = await q.query<{ equity: string }>(LEDGER_EQUITY_SQL, [memberId, userId]);
  return rows[0]?.equity ?? "0.00";
}

async function syncMemberInvestment(
  client: PoolClient,
  userId: string,
  memberId: string,
): Promise<void> {
  await client.query(SYNC_INVESTMENT_SQL, [userId, memberId]);
}

export async function syncMemberInvestmentAmount(
  client: PoolClient,
  userId: string,
  memberId: string,
): Promise<void> {
  await syncMemberInvestment(client, userId, memberId);
}

export async function insertCapitalContribution(
  client: PoolClient,
  userId: string,
  memberId: string,
  params: { amount: string; note: string | null; entryDate: string },
): Promise<CapitalTransaction> {
  const { rows } = await client.query<CapitalTxRow>(
    `INSERT INTO capital_transactions (user_id, member_id, amount, direction, note, entry_date)
     VALUES ($1, $2, $3, 'contribution', $4, $5::date)
     RETURNING ${CAPITAL_TX_RETURN}`,
    [userId, memberId, params.amount, params.note, params.entryDate],
  );
  const row = rows[0]!;
  const memberName = await getMemberName(client, userId, memberId);
  await postCapitalJournalForRow(client, row, memberName);
  return mapCapitalTx(row);
}

export async function createCapitalTx(
  userId: string,
  input: CapitalTxInput,
): Promise<{ transaction: CapitalTransaction; member: ShopMember }> {
  const entryDate = input.entryDate ?? today();
  const amount = input.amount.toFixed(2);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await assertMemberOwned(client, userId, input.memberId);

    if (input.direction === "withdrawal") {
      const current = await memberEquityFromLedger(userId, input.memberId, client);
      if (toCents(amount) > toCents(current)) {
        throw new CapitalWithdrawalLimitError(current);
      }
    }

    const { rows } = await client.query<CapitalTxRow>(
      `INSERT INTO capital_transactions (user_id, member_id, amount, direction, note, entry_date)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING ${CAPITAL_TX_RETURN}`,
      [userId, input.memberId, amount, input.direction, input.note ?? null, entryDate],
    );
    const row = rows[0]!;

    await syncMemberInvestment(client, userId, input.memberId);

    const memberRes = await client.query<ShopMemberRow>(
      `SELECT ${MEMBER_RETURN} FROM shop_members WHERE id = $2 AND user_id = $1`,
      [userId, input.memberId],
    );
    const member = memberRes.rows[0] ? mapShopMemberRow(memberRes.rows[0]) : null;
    if (!member) throw new Error("Member not found after capital tx");

    await postCapitalJournalForRow(client, row, member.name);

    await client.query("COMMIT");

    return { transaction: mapCapitalTx(row), member };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listCapitalTxByMember(
  userId: string,
  memberId: string,
): Promise<CapitalTransaction[]> {
  const { rows } = await pool.query<CapitalTxRow>(
    `SELECT ${CAPITAL_TX_RETURN}
     FROM capital_transactions
     WHERE user_id = $1 AND member_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, memberId],
  );
  return rows.map(mapCapitalTx);
}
