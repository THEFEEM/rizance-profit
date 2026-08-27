import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { completeProductionBatch } from "@/lib/production-queries";
import { productionErrorResponse, readJson } from "@/lib/production-http";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * POST /api/pos/production/batches/[id]/complete — ยืนยันการผลิต
 *
 * ═══ จุดนี้คือจุดที่สต็อกขยับ ═══════════════════════════════════
 * ทุกอย่างอยู่ใน transaction เดียว:
 *   หักวัตถุดิบ → movement → คิดต้นทุน → ซอสเข้าสต็อก → ค่าเฉลี่ยถ่วงน้ำหนัก
 *   → movement → ปิดใบ
 * ล้มขั้นไหนก็ไม่เกิดอะไรเลย ไม่มีทางที่วัตถุดิบหักแล้วซอสไม่เข้า
 *
 * ═══ วัตถุดิบไม่พอ ═════════════════════════════════════════════
 * ตอบ 409 พร้อม shortages[] บอกว่าขาดอะไรเท่าไร — ไม่หักอะไรเลย
 *
 * ═══ กดซ้ำ ════════════════════════════════════════════════════
 * ส่ง idempotencyKey เดิม = คืนใบเดิม ไม่ผลิตซ้ำ
 * ไม่ส่งคีย์แล้วกดซ้ำ = 409 production_batch_not_draft
 */

const bodySchema = z.object({
  actualOutputQty: z.number().min(0).max(10_000_000),
  actualInputs: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        actualQty: z.number().min(0).max(10_000_000),
      }),
    )
    .max(60)
    .optional(),
  note: z.string().trim().max(255).nullish(),
  idempotencyKey: z.string().trim().min(8).max(64).nullish(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { id } = await ctx.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const batch = await completeProductionBatch(userId, id, parsed.data);
    await logManager(userId, "production_batch_completed", {
      batchId: id,
      batchNo: batch.batchNo,
      actualOutputQty: batch.actualOutputQty,
      totalCost: batch.totalCost,
      unitCost: batch.unitCost,
    });
    return NextResponse.json({ data: { batch } });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
