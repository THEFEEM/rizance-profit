import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosOrderNotFoundError,
  PosOrderTransitionError,
  updatePosOrderStatus,
} from "@/lib/pos-order-queries";
import { updatePosOrderSchema } from "@/lib/pos-validation";

/** PATCH /api/pos/orders/:id — staff status transitions (+ link bill on complete). */
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
    throw err;
  }
}
