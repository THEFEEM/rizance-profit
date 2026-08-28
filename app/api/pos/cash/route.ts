import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";
import {
  CashCheckCompletedError,
  CashCheckNotFoundError,
  CashReasonRequiredError,
  OWNER_ACTOR,
  OpeningCashRequiredError,
  addCashExpenseForUser,
  addCashMovementForUser,
  buildCashReport,
  cashDayDetail,
  cashHistory,
  completeCashCheckForUser,
  dailyCashViewForUser,
  startCashCheckForUser,
  type DailyCashView,
} from "@/lib/daily-cash-queries";
import { z } from "zod";

/**
 * Cash Control — ฝั่งเจ้าของ (POS back office) · C-3 ของงานแยก cash ออกจาก duty
 *
 * GET                    → จอเงินสดวันนี้ (+report ถ้าปิดแล้ว)
 * GET ?view=history      → ประวัติเช็คที่ปิดแล้ว (snapshot ล้วน)
 * GET ?date=YYYY-MM-DD   → รายละเอียดเช็คที่ปิดแล้วของวันนั้น + report
 * POST                   → {action:'start'|'expense'|'movement'}
 * PUT                    → ปิดเช็ค: ส่งได้แค่ยอดนับจริง (+เหตุผลถ้าไม่ตรง)
 *
 * ═══ ความปลอดภัย ═══════════════════════════════════════════════
 * เงินสด = การเงินของร้าน → ทุก method ต้องผ่านโหมดผู้จัดการ (0087)
 * เหมือน approve payroll — แค่มีเซสชันร้านไม่พอ (พนักงานหน้าจอขายห้ามเห็น)
 * ตัวเลขทั้งหมด server คำนวณ — client ส่งได้แค่ actual/opening วันแรก/รายการใหม่
 */

async function shopNameOf(userId: string): Promise<string> {
  const { rows } = await pool.query<{ shop_name: string | null }>(
    `SELECT shop_name FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.shop_name ?? "ร้าน";
}

function withReport(view: DailyCashView, shopName: string) {
  return {
    view,
    report: view.status === "completed" ? buildCashReport(view, shopName) : null,
  };
}

function mapError(err: unknown): NextResponse | null {
  if (err instanceof CashCheckNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof CashCheckCompletedError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof CashReasonRequiredError || err instanceof OpeningCashRequiredError) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const params = new URL(req.url).searchParams;

  if (params.get("view") === "history") {
    const limit = Number(params.get("limit") ?? "30");
    return NextResponse.json({
      data: { history: await cashHistory(userId, Number.isFinite(limit) ? limit : 30) },
    });
  }

  const date = params.get("date");
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const detail = await cashDayDetail(userId, date);
    if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: withReport(detail, await shopNameOf(userId)) });
  }

  const view = await dailyCashViewForUser(userId);
  return NextResponse.json({ data: withReport(view, await shopNameOf(userId)) });
}

// schema เดียวกับฝั่ง token (/api/public/hr/[token]/cash) — กติกาเดียวทั้งระบบ
const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    openingCash: z.number().min(0).max(10_000_000).nullish(),
  }),
  z.object({
    action: z.literal("expense"),
    label: z.string().trim().min(1).max(255),
    amount: z.number().positive().max(10_000_000),
    category: z.enum(["materials", "equipment", "utilities", "expense_misc"]).optional(),
  }),
  z.object({
    action: z.literal("movement"),
    movementType: z.enum(["cash_in", "withdrawal"]),
    amount: z.number().positive().max(10_000_000),
    reason: z.string().trim().min(1).max(255),
  }),
]);

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const d = parsed.data;
    const view =
      d.action === "start"
        ? await startCashCheckForUser(userId, { openingCash: d.openingCash ?? null })
        : d.action === "expense"
          ? await addCashExpenseForUser(userId, d)
          : await addCashMovementForUser(userId, OWNER_ACTOR, d);
    return NextResponse.json({ data: withReport(view, await shopNameOf(userId)) });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}

const putSchema = z.object({
  actualCash: z.number().min(0).max(10_000_000),
  differenceReason: z.string().trim().max(255).nullish(),
});

export async function PUT(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const view = await completeCashCheckForUser(userId, OWNER_ACTOR, parsed.data);
    return NextResponse.json({ data: withReport(view, await shopNameOf(userId)) });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}
