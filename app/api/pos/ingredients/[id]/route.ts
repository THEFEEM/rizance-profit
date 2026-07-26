import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import { updatePosIngredient } from "@/lib/pos-ingredient-queries";
import { updatePosIngredientSchema } from "@/lib/pos-validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = updatePosIngredientSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const ingredient = await updatePosIngredient(userId, id, parsed.data);
  if (!ingredient) return posNotFoundResponse();
  return NextResponse.json({ data: ingredient });
}
