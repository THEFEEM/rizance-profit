import { NextRequest, NextResponse } from "next/server";
import {
  CashCheckCompletedError,
  CashCheckNotFoundError,
  CashReasonRequiredError,
  OpeningCashRequiredError,
  addCashExpense,
  addCashMovement,
  completeCashCheck,
  dailyCashView,
  startCashCheck,
} from "@/lib/daily-cash-queries";
import { NotManagerError } from "@/lib/manager-duty-queries";
import { staffRateLimitExceeded } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * เงินสดประจำวัน — ฝั่งแอปผู้จัดการ /e/[token]
 *
 * GET   → จอเงินสดวันนี้ (ปิดแล้ว = snapshot · ยังไม่ปิด = สด)
 * POST  → {action:'start'|'expense'|'movement'} เริ่มเช็ค / เพิ่มรายจ่าย / เงินเข้า-ถอน
 * PUT   → ปิดเช็ค: client ส่งได้แค่ "นับจริง" + เหตุผลถ้าไม่ตรง
 *          ยอดขาย/รายจ่าย/expected ทั้งหมด server คำนวณ ณ วินาทีปิด
 */

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = staffRateLimitExceeded(req);
  return retryAfter === null
    ? null
    : NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
}

function mapError(err: unknown): NextResponse | null {
  if (err instanceof NotManagerError) {
    return NextResponse.json({ error: "not_manager" }, { status: 403 });
  }
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;
  try {
    const view = await dailyCashView(token);
    if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: view });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    openingCash: z.number().min(0).max(10_000_000).nullish(),
  }),
  z.object({
    action: z.literal("expense"),
    label: z.string().trim().min(1).max(255),
    amount: z.number().positive().max(10_000_000),
    // ต้องตรงกับ CHECK ของ expense_entries (0009) — "อื่น ๆ" = expense_misc
    category: z.enum(["materials", "equipment", "utilities", "expense_misc"]).optional(),
  }),
  z.object({
    action: z.literal("movement"),
    movementType: z.enum(["cash_in", "withdrawal"]),
    amount: z.number().positive().max(10_000_000),
    reason: z.string().trim().min(1).max(255),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;

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
        ? await startCashCheck(token, { openingCash: d.openingCash ?? null })
        : d.action === "expense"
          ? await addCashExpense(token, d)
          : await addCashMovement(token, d);
    return NextResponse.json({ data: view });
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    return NextResponse.json({ data: await completeCashCheck(token, parsed.data) });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}
