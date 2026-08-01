import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosOrderHasBillError,
  PosOrderNotFoundError,
  PosOrderTransitionError,
  setOrderPaymentTiming,
  updatePosOrderStatus,
} from "@/lib/pos-order-queries";
import { setPaymentTimingSchema, updatePosOrderSchema } from "@/lib/pos-validation";

/**
 * PATCH /api/pos/orders/:id
 *   { status, cancelReason?, billId? } → เปลี่ยนสถานะ (+ ผูกบิลตอนส่งมอบ)
 *   { paymentTiming }                  → สลับจังหวะเก็บเงินรายออเดอร์ (ไม่แตะสถานะ)
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

  // สลับจังหวะเก็บเงินอย่างเดียว (ไม่มี status มาด้วย)
  const timingOnly = setPaymentTimingSchema.safeParse(body);
  if (timingOnly.success && !(body as { status?: unknown }).status) {
    try {
      const order = await setOrderPaymentTiming(userId, id, timingOnly.data.paymentTiming);
      return NextResponse.json({ data: order });
    } catch (err) {
      if (err instanceof PosOrderNotFoundError) return posNotFoundResponse();
      throw err;
    }
  }

  const parsed = updatePosOrderSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const order = await updatePosOrderStatus(userId, id, parsed.data);
    return NextResponse.json({ data: order });
  } catch (err) {
    if (err instanceof PosOrderNotFoundError) return posNotFoundResponse();
    if (err instanceof PosOrderTransitionError) {
      return posErrorResponse("invalid_transition", 409);
    }
    // รู A: เก็บเงินแล้วต้องยกเลิกบิลก่อนจึงยกเลิกออเดอร์ได้
    if (err instanceof PosOrderHasBillError) {
      return NextResponse.json(
        { error: "order_has_bill", billId: err.billId },
        { status: 409 },
      );
    }
    throw err;
  }
}
