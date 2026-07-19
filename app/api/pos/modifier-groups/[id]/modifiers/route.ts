import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosModifierNameExistsError,
  createPosModifier,
} from "@/lib/pos-modifier-queries";
import { createPosModifierSchema } from "@/lib/pos-validation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id: groupId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createPosModifierSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const modifier = await createPosModifier(userId, groupId, parsed.data);
    if (!modifier) return posNotFoundResponse();
    return NextResponse.json({ data: modifier }, { status: 201 });
  } catch (err) {
    if (err instanceof PosModifierNameExistsError) {
      return posErrorResponse("modifier_name_exists", 409);
    }
    throw err;
  }
}
