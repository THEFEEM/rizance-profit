import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosModifierGroupNameExistsError,
  PosModifierInUseError,
  deletePosModifierGroup,
  updatePosModifierGroup,
} from "@/lib/pos-modifier-queries";
import { updatePosModifierGroupSchema } from "@/lib/pos-validation";

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

  const parsed = updatePosModifierGroupSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const group = await updatePosModifierGroup(userId, id, parsed.data);
    if (!group) return posNotFoundResponse();
    return NextResponse.json({ data: group });
  } catch (err) {
    if (err instanceof PosModifierGroupNameExistsError) {
      return posErrorResponse("group_name_exists", 409);
    }
    throw err;
  }
}

/** DELETE /api/pos/modifier-groups/:id — ลบได้เมื่อไม่มีสินค้าผูกและไม่มีตัวเลือกข้างใน */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const ok = await deletePosModifierGroup(userId, id);
    if (!ok) return posNotFoundResponse();
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof PosModifierInUseError) {
      return NextResponse.json(
        { error: "group_in_use", reason: err.reason, count: err.count },
        { status: 409 },
      );
    }
    throw err;
  }
}
