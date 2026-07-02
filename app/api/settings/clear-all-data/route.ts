import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Transaction tables cleared across every mode. All carry a user_id column, so a
 * single WHERE user_id = $1 per table is sufficient. Entities that define the
 * account itself — users, shops (users row), booths, projects, project_activities,
 * shop_members, booth_members, project_members, token_budgets, stripe_payments,
 * savings_goals, pricing/menu setup — are intentionally left untouched.
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

    await client.query("COMMIT");
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
