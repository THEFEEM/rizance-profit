import { NextRequest, NextResponse } from "next/server";
import { CONTEXT_COOKIE, parseContextCookie } from "@/lib/context";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

type ClearMode = "regular" | "personal" | "booth" | "project";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const raw = req.cookies.get(CONTEXT_COOKIE)?.value;
  const ctx = parseContextCookie(raw);
  if (ctx.type === "invalid") {
    return NextResponse.json({ error: { message: "Invalid context" } }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let mode: ClearMode;

    if (ctx.type === "regular") {
      mode = "regular";
      await client.query(`DELETE FROM expense_entries WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM income_entries WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM chat_messages WHERE user_id = $1`, [user.id]);
    } else if (ctx.type === "personal") {
      mode = "personal";
      await client.query(`DELETE FROM personal_expense_entries WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM personal_income_entries WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM personal_chat_messages WHERE user_id = $1`, [user.id]);
    } else if (ctx.type === "booth") {
      mode = "booth";
      await client.query(
        `DELETE FROM booth_expense_entries WHERE booth_id = $2 AND user_id = $1`,
        [user.id, ctx.boothId],
      );
      await client.query(
        `DELETE FROM booth_income_entries WHERE booth_id = $2 AND user_id = $1`,
        [user.id, ctx.boothId],
      );
      await client.query(
        `DELETE FROM booth_chat_messages WHERE booth_id = $2 AND user_id = $1`,
        [user.id, ctx.boothId],
      );
    } else {
      mode = "project";
      await client.query(
        `DELETE FROM project_expense_entries
         WHERE user_id = $1
           AND activity_id IN (
             SELECT id FROM project_activities WHERE project_id = $2
           )`,
        [user.id, ctx.projectId],
      );
      await client.query(
        `DELETE FROM project_income_entries
         WHERE user_id = $1
           AND activity_id IN (
             SELECT id FROM project_activities WHERE project_id = $2
           )`,
        [user.id, ctx.projectId],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ data: { ok: true, mode } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
