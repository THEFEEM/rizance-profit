import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CONTEXT_COOKIE,
  contextCookieOptions,
  resolveTodayContext,
  type ResolvedTodayContext,
} from "@/lib/context";
import { pool } from "@/lib/db";
import { fieldErrorsFrom } from "@/lib/validation";
import { getCurrentUser } from "@/lib/session";
import type { PoolClient } from "pg";

/** Placeholder shop name after shop reset — user renames on /shop/new. */
const RESET_SHOP_NAME = "ร้านของฉัน";

const clearModeSchema = z.object({
  mode: z.enum(["personal", "shop", "booth", "org"]),
});

type ClearMode = z.infer<typeof clearModeSchema>["mode"];

async function clearPersonal(client: PoolClient, userId: string) {
  await client.query(`DELETE FROM personal_income_entries WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM personal_expense_entries WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM personal_chat_messages WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM savings_goals WHERE user_id = $1`, [userId]);
}

/** Regular shop mode — one shop per user (no shops table; scoped by user_id). */
async function clearShop(client: PoolClient, userId: string) {
  const tables = [
    "income_entries",
    "expense_entries",
    "chat_messages",
    "money_transfers",
    "capital_transactions",
    "profit_withdrawals",
    "creditor_repayments",
  ] as const;

  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  }

  await client.query(`DELETE FROM shop_members WHERE user_id = $1`, [userId]);
  await client.query(
    `UPDATE users SET shop_name = $2, updated_at = now() WHERE id = $1`,
    [userId, RESET_SHOP_NAME],
  );
}

async function clearBooth(client: PoolClient, userId: string, boothId: string) {
  await client.query(
    `DELETE FROM booth_income_entries WHERE booth_id = $1 AND user_id = $2`,
    [boothId, userId],
  );
  await client.query(
    `DELETE FROM booth_expense_entries WHERE booth_id = $1 AND user_id = $2`,
    [boothId, userId],
  );
  await client.query(
    `DELETE FROM booth_chat_messages WHERE booth_id = $1 AND user_id = $2`,
    [boothId, userId],
  );
  await client.query(`DELETE FROM booth_members WHERE booth_id = $1`, [boothId]);
  await client.query(`DELETE FROM booths WHERE id = $1 AND user_id = $2`, [boothId, userId]);
}

async function clearOrg(client: PoolClient, userId: string, projectId: string) {
  await client.query(
    `DELETE FROM project_income_entries
     WHERE user_id = $1
       AND activity_id IN (SELECT id FROM project_activities WHERE project_id = $2)`,
    [userId, projectId],
  );
  await client.query(
    `DELETE FROM project_expense_entries
     WHERE user_id = $1
       AND activity_id IN (SELECT id FROM project_activities WHERE project_id = $2)`,
    [userId, projectId],
  );
  await client.query(`DELETE FROM project_members WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM project_activities WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
}

function contextMismatch(bodyMode: ClearMode, ctx: ResolvedTodayContext): string | null {
  if (bodyMode === "personal" && ctx.mode !== "personal") {
    return "โหมดไม่ตรงกับบริบทปัจจุบัน — สลับเป็นโหมดส่วนตัวก่อน";
  }
  if (bodyMode === "shop" && ctx.mode !== "regular") {
    return "โหมดไม่ตรงกับบริบทปัจจุบัน — สลับเป็นโหมดร้านค้าก่อน";
  }
  if (bodyMode === "booth" && ctx.mode !== "booth") {
    return "โหมดไม่ตรงกับบริบทปัจจุบัน — สลับเป็นบูธที่ต้องการรีเซ็ตก่อน";
  }
  if (bodyMode === "org" && ctx.mode !== "project") {
    return "โหมดไม่ตรงกับบริบทปัจจุบัน — สลับเป็นองค์กรที่ต้องการรีเซ็ตก่อน";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = clearModeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const rawCookie = req.cookies.get(CONTEXT_COOKIE)?.value;
  const ctx = await resolveTodayContext(user.id, req, rawCookie);
  const { mode } = parsed.data;

  const mismatch = contextMismatch(mode, ctx);
  if (mismatch) {
    return NextResponse.json({ error: { message: mismatch } }, { status: 400 });
  }

  let redirect: string | undefined;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    switch (mode) {
      case "personal":
        await clearPersonal(client, user.id);
        break;
      case "shop":
        await clearShop(client, user.id);
        redirect = "/shop/new";
        break;
      case "booth":
        if (ctx.mode !== "booth") throw new Error("unreachable");
        await clearBooth(client, user.id, ctx.boothId);
        redirect = "/booth/new";
        break;
      case "org":
        if (ctx.mode !== "project") throw new Error("unreachable");
        await clearOrg(client, user.id, ctx.projectId);
        redirect = "/projects/new";
        break;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const res = NextResponse.json({
    data: { ok: true as const, ...(redirect ? { redirect } : {}) },
  });

  if (mode === "shop" || mode === "booth" || mode === "org") {
    res.cookies.set(CONTEXT_COOKIE, "regular", contextCookieOptions());
  }

  return res;
}
