import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  requireManagerUnlock,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  createPosIngredient,
  listModifierRecipes,
  listPosIngredients,
  listProductRecipes,
} from "@/lib/pos-ingredient-queries";
import { createPosIngredientSchema } from "@/lib/pos-validation";

/**
 * GET  /api/pos/ingredients — วัตถุดิบ + สูตร (สินค้า/modifier) ทั้งร้าน
 * POST /api/pos/ingredients — เพิ่มวัตถุดิบ
 *
 * ═══ Inventory I-1b (8 ก.ย. 2569 · C3 = B) ═══════════════════════
 * mutation ของคลังต้องอยู่ในโหมดผู้จัดการ (requireManagerUnlock)
 * — การซ่อนแท็บ "คลัง" ฝั่ง client เป็นแค่การวาดจอ ไม่ใช่สิทธิ์
 * GET คงนโยบายเดิม (session + plan) เพราะหน้าขาย/สินค้าใช้อ่านสูตร
 * market-trip ยังไม่ gate (TTL 15 นาทีอาจหมดระหว่างเดินตลาด)
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const [ingredients, productRecipes, modifierRecipes] = await Promise.all([
    listPosIngredients(userId),
    listProductRecipes(userId),
    listModifierRecipes(userId),
  ]);

  return NextResponse.json({
    data: {
      ingredients,
      productRecipes: Object.fromEntries(productRecipes),
      modifierRecipes: Object.fromEntries(modifierRecipes),
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createPosIngredientSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const ingredient = await createPosIngredient(userId, parsed.data);
  return NextResponse.json({ data: ingredient }, { status: 201 });
}
