import { NextResponse } from "next/server";
import { CONTEXT_COOKIE, contextCookieOptions } from "@/lib/context";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

/** Placeholder shop name after full reset — user renames on /shop/new. */
const RESET_SHOP_NAME = "ร้านของฉัน";

/**
 * Transaction tables cleared across every mode. All carry user_id.
 * capital_transactions / profit_withdrawals must be cleared before shop_members.
 */
const TRANSACTION_TABLES = [
  "income_entries",
  "expense_entries",
  "chat_messages",
  "money_transfers",
  "capital_transactions",
  "profit_withdrawals",
  "creditor_repayments",
  "personal_income_entries",
  "personal_expense_entries",
  "personal_chat_messages",
  "booth_income_entries",
  "booth_expense_entries",
  "booth_chat_messages",
  "project_income_entries",
  "project_expense_entries",
] as const;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const table of TRANSACTION_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [user.id]);
    }

    // Shop: no shops table — members + shop_name on users (subscription untouched).
    await client.query(`DELETE FROM shop_members WHERE user_id = $1`, [user.id]);
    await client.query(
      `UPDATE users SET shop_name = $2, updated_at = now() WHERE id = $1`,
      [user.id, RESET_SHOP_NAME],
    );

    // Booths (booth_members cascade via booth_id FK).
    await client.query(`DELETE FROM booths WHERE user_id = $1`, [user.id]);

    // Projects (project_activities + project_members cascade via project_id FK).
    await client.query(`DELETE FROM projects WHERE user_id = $1`, [user.id]);

    await client.query("COMMIT");

    const res = NextResponse.json({
      data: { ok: true, redirect: "/shop/new" as const },
    });
    res.cookies.set(CONTEXT_COOKIE, "regular", contextCookieOptions());
    return res;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
