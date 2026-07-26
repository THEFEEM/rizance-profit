import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosIngredientNotFoundError,
  restockIngredient,
} from "@/lib/pos-ingredient-queries";
import { restockIngredientSchema } from "@/lib/pos-validation";

/** POST /api/pos/ingredients/restock — รับของเข้า (+ บันทึกรายจ่ายวัตถุดิบอัตโนมัติ) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = restockIngredientSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const result = await restockIngredient(userId, parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) return posNotFoundResponse();
    throw err;
  }
}
