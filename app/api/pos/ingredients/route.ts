import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  createPosIngredient,
  listModifierRecipes,
  listPosIngredients,
  listProductRecipes,
} from "@/lib/pos-ingredient-queries";
import { createPosIngredientSchema } from "@/lib/pos-validation";

/** GET /api/pos/ingredients — วัตถุดิบ + สูตร (สินค้า/modifier) ทั้งร้าน */
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
