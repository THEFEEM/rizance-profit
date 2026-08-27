import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { createProductionBatch, listProductionBatches } from "@/lib/production-queries";
import { productionErrorResponse, readJson } from "@/lib/production-http";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * GET  /api/pos/production/batches   — ประวัติการผลิต (?from=&to=&ingredientId=&limit=)
 * POST /api/pos/production/batches   — เปิดใบผลิต (ยังไม่แตะสต็อก)
 *
 * เปิดใบแล้วสต็อกยังไม่ขยับ — ขยับตอนกด "ยืนยันการผลิต" (POST .../complete)
 * แยกสองขั้นเพราะผู้ผลิตต้องชั่งผลผลิตจริงก่อนจะรู้ต้นทุนต่อกรัม
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const ingredientId = sp.get("ingredientId");
  const limit = Number(sp.get("limit") ?? 50);

  if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  return NextResponse.json({
    data: {
      batches: await listProductionBatches(userId, {
        from: from ?? undefined,
        to: to ?? undefined,
        outputIngredientId: ingredientId ?? undefined,
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    },
  });
}

const bodySchema = z.object({
  recipeId: z.string().uuid(),
  multiplier: z.number().positive().max(100).optional(),
  note: z.string().trim().max(255).nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const batch = await createProductionBatch(userId, parsed.data);
    await logManager(userId, "production_batch_created", {
      batchId: batch.id,
      batchNo: batch.batchNo,
    });
    return NextResponse.json({ data: { batch } }, { status: 201 });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
