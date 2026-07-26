import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import { reviewOrderSlip } from "@/lib/pos-order-queries";

const reviewSchema = z.object({
  approve: z.boolean(),
  reason: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

/**
 * PATCH /api/pos/orders/:id/slip — พนักงานตรวจสลิปที่ลูกค้าแนบมา
 * approve=true → ยืนยันว่าเงินเข้าจริง (ยังไม่ลงบัญชี รายรับเกิดตอนปิดบิล)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const order = await reviewOrderSlip(userId, id, parsed.data);
  if (!order) return posNotFoundResponse();
  return NextResponse.json({ data: order });
}
