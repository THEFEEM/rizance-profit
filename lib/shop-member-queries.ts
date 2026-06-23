import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { toCents } from "@/lib/money";
import {
  insertCapitalContribution,
  syncMemberInvestmentAmount,
} from "@/lib/shop-capital-queries";
import type { ShopMemberInput, ShopMemberPatchInput } from "@/lib/shop-validation";
import type { ShopMember } from "@/types/shop";

type ShopMemberRow = {
  id: string;
  user_id: string;
  name: string;
  role: string;
  investment_amount: string;
  created_at: Date | string;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapShopMember(r: ShopMemberRow): ShopMember {
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

export async function listShopMembers(userId: string): Promise<ShopMember[]> {
  const { rows } = await pool.query<ShopMemberRow>(
    `SELECT ${MEMBER_RETURN}
     FROM shop_members
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );
  return rows.map(mapShopMember);
}

export async function createShopMember(
  userId: string,
  input: ShopMemberInput,
): Promise<ShopMember | null> {
  const amount = input.investmentAmount.toFixed(2);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<ShopMemberRow>(
      `INSERT INTO shop_members (user_id, name, role, investment_amount)
       VALUES ($1, $2, $3, $4)
       RETURNING ${MEMBER_RETURN}`,
      [userId, input.name, input.role, amount],
    );
    if (!rows[0]) throw new Error("Could not create member");

    const memberId = rows[0].id;
    if (toCents(amount) > 0) {
      await insertCapitalContribution(client, userId, memberId, {
        amount,
        note: "ยอดยกมา",
        entryDate: today(),
      });
      await syncMemberInvestmentAmount(client, userId, memberId);
    }

    const { rows: synced } = await client.query<ShopMemberRow>(
      `SELECT ${MEMBER_RETURN} FROM shop_members WHERE id = $2 AND user_id = $1`,
      [userId, memberId],
    );

    await client.query("COMMIT");
    return synced[0] ? mapShopMember(synced[0]) : null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateShopMember(
  userId: string,
  memberId: string,
  input: ShopMemberPatchInput,
): Promise<ShopMember | null> {
  const sets: string[] = [];
  const params: (string | number)[] = [userId, memberId];
  let idx = 3;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx += 1;
  }
  if (input.role !== undefined) {
    sets.push(`role = $${idx}`);
    params.push(input.role);
    idx += 1;
  }
  if (input.investmentAmount !== undefined) {
    sets.push(`investment_amount = $${idx}`);
    params.push(input.investmentAmount.toFixed(2));
    idx += 1;
  }
  if (sets.length === 0) {
    const existing = await getShopMember(userId, memberId);
    return existing;
  }

  const { rows } = await pool.query<ShopMemberRow>(
    `UPDATE shop_members SET ${sets.join(", ")}
     WHERE id = $2 AND user_id = $1
     RETURNING ${MEMBER_RETURN}`,
    params,
  );
  return rows[0] ? mapShopMember(rows[0]) : null;
}

export async function getShopMember(
  userId: string,
  memberId: string,
): Promise<ShopMember | null> {
  const { rows } = await pool.query<ShopMemberRow>(
    `SELECT ${MEMBER_RETURN}
     FROM shop_members
     WHERE id = $2 AND user_id = $1`,
    [userId, memberId],
  );
  return rows[0] ? mapShopMember(rows[0]) : null;
}

export async function deleteShopMember(userId: string, memberId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM shop_members WHERE id = $2 AND user_id = $1`,
    [userId, memberId],
  );
  return (rowCount ?? 0) > 0;
}
