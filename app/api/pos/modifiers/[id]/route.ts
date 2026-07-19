import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosModifierNameExistsError,
  updatePosModifier,
} from "@/lib/pos-modifier-queries";
import { updatePosModifierSchema } from "@/lib/pos-validation";

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

  const parsed = updatePosModifierSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const modifier = await updatePosModifier(userId, id, parsed.data);
    if (!modifier) return posNotFoundResponse();
    return NextResponse.json({ data: modifier });
  } catch (err) {
    if (err instanceof PosModifierNameExistsError) {
      return posErrorResponse("modifier_name_exists", 409);
    }
    throw err;
  }
}
