import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosModifierInUseError,
  PosModifierNameExistsError,
  deletePosModifier,
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

/** DELETE /api/pos/modifiers/:id — ลบได้เมื่อยังไม่เคยขายและไม่อยู่ในออเดอร์ที่เปิดอยู่ */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const ok = await deletePosModifier(userId, id);
    if (!ok) return posNotFoundResponse();
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof PosModifierInUseError) {
      return NextResponse.json(
        { error: "modifier_in_use", reason: err.reason, count: err.count },
        { status: 409 },
      );
    }
    throw err;
  }
}
