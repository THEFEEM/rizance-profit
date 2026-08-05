import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { PosNotEnoughPointsError, redeemPoints } from "@/lib/pos-member-queries";

const schema = z.object({
  points: z.number().int().min(1).max(1_000_000),
  note: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(200).optional(),
  ),
});

/**
 * POST /api/pos/members/[id]/redeem — ตัดแต้มเมื่อลูกค้าแลกของ
 *
 * ⚠️ ไม่ลดยอดบิลและไม่แตะบัญชี — ของแถมส่งมือ (ดูหมายเหตุใน 0068)
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const member = await redeemPoints(userId, id, parsed.data.points, parsed.data.note);
    return NextResponse.json({ data: { member } });
  } catch (err) {
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
