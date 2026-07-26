import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import { setModifierRecipe } from "@/lib/pos-ingredient-queries";
import { setRecipeSchema } from "@/lib/pos-validation";

/** PUT /api/pos/modifiers/:id/recipe — วัตถุดิบที่ท็อปปิ้งนี้ใช้เพิ่ม */
export async function PUT(
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

  const parsed = setRecipeSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const ok = await setModifierRecipe(userId, id, parsed.data.lines);
  if (!ok) return posNotFoundResponse();
  return NextResponse.json({ data: { modifierId: id, lines: parsed.data.lines.length } });
}
