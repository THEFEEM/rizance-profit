import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { closePosBillSchema, listPosBillsQuerySchema } from "@/lib/pos-validation";
import { listPosBillsByDate } from "@/lib/pos-bill-queries";
import {
  PosEmptyCartError,
  PosOrderLinkFailedError,
  PosPaymentMismatchError,
  PosProductNotFoundError,
  closePosBill,
} from "@/lib/pos-close-bill-queries";
import {
  PosInvalidModifierError,
  PosModifierRuleError,
} from "@/lib/pos-modifier-queries";
import { today } from "@/lib/date";

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const parsed = listPosBillsQuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  const entryDate = parsed.data.date ?? today();
  const bills = await listPosBillsByDate(userId, entryDate);
  return NextResponse.json({ data: { bills } });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = closePosBillSchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const result = await closePosBill(userId, parsed.data);

    return NextResponse.json(
      {
        data: {
          bill: result.bill,
          items: result.items,
          // แต้มสมาชิก — ของแถม ไม่ใช่ยอดเงิน (ดู 0068)
          pointsEarned: result.pointsEarned ?? 0,
          memberPoints: result.memberPoints,
          warnings:
            result.negativeStockProductIds.length > 0
              ? {
                  negativeStock: result.negativeStockProductIds,
                  message: "สต็อกบางรายการติดลบแล้ว — บิลบันทึกสำเร็จ",
                }
              : undefined,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof PosProductNotFoundError) {
      return posNotFoundResponse();
    }
    if (err instanceof PosEmptyCartError) {
      return posErrorResponse("empty_cart", 400);
    }
    if (err instanceof PosInvalidModifierError) {
      return posErrorResponse("invalid_modifier", 400);
    }
    if (err instanceof PosPaymentMismatchError) {
      return posErrorResponse("payment_mismatch", 400);
    }
    if (err instanceof PosModifierRuleError) {
      return posErrorResponse("modifier_required", 400);
    }
    // ผูกบิลเข้าออเดอร์ไม่ได้ → ทั้งบิล rollback แล้ว ไม่มีสภาพครึ่งทาง
    if (err instanceof PosOrderLinkFailedError) {
      return posErrorResponse("order_link_failed", 409);
    }
    throw err;
  }
}
