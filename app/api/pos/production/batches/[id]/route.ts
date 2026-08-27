import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { cancelProductionBatch, getProductionBatch } from "@/lib/production-queries";
import { productionErrorResponse } from "@/lib/production-http";
import { logManager } from "@/lib/manager-pin-queries";

/**
 * GET    /api/pos/production/batches/[id]   — รายละเอียดใบผลิต + วัตถุดิบที่ใช้
 * DELETE /api/pos/production/batches/[id]   — ยกเลิกใบร่าง
 *
 * ยกเลิกได้เฉพาะใบที่ยังเป็นร่าง — ใบที่ปิดแล้วสต็อกขยับไปแล้ว
 * ถ้าผลิตผิดต้องแก้ด้วยการตรวจนับ (adjustment) ไม่ใช่ลบประวัติ
 */

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { id } = await ctx.params;
  const batch = await getProductionBatch(userId, id);
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { batch } });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { id } = await ctx.params;
  try {
    const batch = await cancelProductionBatch(userId, id);
    if (!batch) {
      // ไม่มีใบนี้ หรือมีแต่ไม่ใช่ร่างแล้ว — แยกให้ผู้ใช้รู้ว่าเพราะอะไร
      const exist = await getProductionBatch(userId, id);
      if (!exist) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ error: "production_batch_not_draft" }, { status: 409 });
    }
    await logManager(userId, "production_batch_cancelled", { batchId: id });
    return NextResponse.json({ data: { batch } });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
