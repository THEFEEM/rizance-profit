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
 * ═══ Inventory policy (10 ก.ย. 2569 · /stock เป็นหน้า staff) ═══════════
 * GET  = staff-safe (session + plan) — พนักงานดูสต็อก/กลุ่ม/ค้นหาได้ · หน้าขาย/สินค้าก็ใช้อ่านสูตร
 *        ⚠️ payload มี avg_cost/purchase_price (ต้นทุน) — ยังไม่ตัดเพราะ Data Guard ฝั่ง client ใช้ตรวจ
 *        ข้อมูลเพี้ยน (staff-safe "report issue") · โน้ตเป็น residual ในรายงาน policy
 * POST = owner-sensitive (master data) → requireManagerUnlock
 * การซ่อนปุ่ม/แท็บฝั่ง client เป็นแค่การวาดจอ ไม่ใช่สิทธิ์
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
