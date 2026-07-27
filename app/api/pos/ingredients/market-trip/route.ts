import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosIngredientNotFoundError,
  restockIngredientsBatch,
} from "@/lib/pos-ingredient-queries";
import { marketTripSchema } from "@/lib/pos-validation";

/**
 * POST /api/pos/ingredients/market-trip
 * รับของทั้งตะกร้าจากการไปตลาด 1 รอบ → 1 รายการรายจ่าย + รับสต๊อกทุกตัวใน transaction เดียว
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = marketTripSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  if (parsed.data.lines.length === 0 && (parsed.data.extraItems?.length ?? 0) === 0) {
    return posErrorResponse("empty_trip", 400);
  }

  try {
    const result = await restockIngredientsBatch(userId, parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) return posNotFoundResponse();
    throw err;
  }
}
