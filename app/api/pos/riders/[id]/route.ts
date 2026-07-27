import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  RiderNotFoundError,
  deleteRider,
  settleRiderCash,
  updateRider,
} from "@/lib/pos-rider-queries";
import { riderUpdateSchema } from "@/lib/pos-validation";

/**
 * PATCH /api/pos/riders/:id
 *   { name?, phone?, isActive?, rotateToken? } → แก้ข้อมูล / ปิดลิงก์ / ออกลิงก์ใหม่
 *   { settleCash: true }                        → ยืนยันว่ารับเงินสดจากคนส่งครบแล้ว
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

  const parsed = riderUpdateSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    if (parsed.data.settleCash) {
      const settled = await settleRiderCash(userId, id);
      return NextResponse.json({ data: { settledOrders: settled } });
    }
    const rider = await updateRider(userId, id, parsed.data);
    return NextResponse.json({ data: rider });
  } catch (err) {
    if (err instanceof RiderNotFoundError) return posErrorResponse("rider_not_found", 404);
    throw err;
  }
}

/** DELETE /api/pos/riders/:id — ลบคนส่ง (ออเดอร์เก่ายังอยู่ rider_id → NULL) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  try {
    await deleteRider(userId, id);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof RiderNotFoundError) return posErrorResponse("rider_not_found", 404);
    throw err;
  }
}
