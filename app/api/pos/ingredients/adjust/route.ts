import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosIngredientNotFoundError,
  adjustIngredientStock,
} from "@/lib/pos-ingredient-queries";
import { adjustIngredientSchema } from "@/lib/pos-validation";

/** POST /api/pos/ingredients/adjust — ตรวจนับ/ปรับสต๊อกเป็นจำนวนจริง */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = adjustIngredientSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const ingredient = await adjustIngredientStock(
      userId,
      parsed.data.ingredientId,
      parsed.data.actualQty,
      parsed.data.note,
    );
    return NextResponse.json({ data: ingredient });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) return posNotFoundResponse();
    throw err;
  }
}
