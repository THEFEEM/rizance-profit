import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosNotEnoughPointsError,
  PosRedeemCodeInvalidError,
  consumeRedeemCode,
} from "@/lib/pos-member-queries";

/**
 * รับได้ 2 รูปแบบ:
 *   "RZC1:AB3D9K"  ← ที่อยู่ใน QR (มี prefix กันสแกน QR อื่นมั่ว)
 *   "AB3D9K"       ← พนักงานพิมพ์มือตอนกล้องสแกนไม่ติด
 */
const schema = z.object({
  code: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/^RZC1:/, "") : v),
    z.string().regex(/^[2-9A-HJ-NP-Z]{6}$/, "invalid code"),
  ),
});

/**
 * POST /api/pos/members/redeem-code — POS สแกน/กรอกโค้ดเพื่อตัดแต้ม
 *
 * ⚠️ ไม่ลดยอดบิลและไม่แตะบัญชี — รางวัลส่งมือ (ดู 0068/0070)
 * ต้องมี session ของร้าน → ลูกค้าเรียกเองไม่ได้
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_code", 400);

  try {
    const result = await consumeRedeemCode(userId, parsed.data.code);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof PosRedeemCodeInvalidError) {
      // แยก 3 กรณีให้พนักงานรู้ว่าต้องทำอะไรต่อ
      return posErrorResponse(`code_${err.kind}`, 400);
    }
    if (err instanceof PosNotEnoughPointsError) {
      return NextResponse.json(
        { error: "not_enough_points", data: { points: err.points } },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "member_not_found") {
      return posErrorResponse("not_found", 404);
    }
    throw err;
  }
}
