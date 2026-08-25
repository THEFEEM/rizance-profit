import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PurchaseUnitNotFoundError,
  deactivatePurchaseUnit,
  listPurchaseUnits,
} from "@/lib/stock-purchase-queries";
import { upsertPurchaseUnit } from "@/lib/stock-purchase-queries";
import { PosIngredientNotFoundError } from "@/lib/pos-ingredient-queries";
import { z } from "zod";

/**
 * หน่วยบรรจุของวัตถุดิบ — "1 แพ็ค = 84 แผ่น"
 *
 * GET    ?ingredientId=  → หน่วยที่ซื้อได้ (รวมหน่วยสต็อกเองตัวคูณ 1)
 * POST                   → เพิ่ม/แก้
 * DELETE ?id=            → ปิดใช้งาน (ไม่ลบ เพราะเอกสารเก่าอ้างชื่อไว้)
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const ingredientId = new URL(req.url).searchParams.get("ingredientId");
  if (!ingredientId) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    return NextResponse.json({ data: await listPurchaseUnits(userId, ingredientId) });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  ingredientId: z.string().uuid(),
  unitName: z.string().trim().min(1).max(30),
  conversionFactor: z.number().positive().max(1_000_000),
  isDefault: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    await upsertPurchaseUnit(userId, parsed.data);
  } catch (err) {
    if (err instanceof PurchaseUnitNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
  return NextResponse.json({
    data: await listPurchaseUnits(userId, parsed.data.ingredientId),
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const ok = await deactivatePurchaseUnit(userId, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
