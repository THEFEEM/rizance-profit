import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { shopMemberPatchSchema } from "@/lib/shop-validation";
import { deleteShopMember, updateShopMember } from "@/lib/shop-member-queries";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = shopMemberPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const member = await updateShopMember(userId, id, parsed.data);
  if (!member) {
    return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
  }

  return NextResponse.json({ data: member });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;
  const ok = await deleteShopMember(userId, id);
  if (!ok) {
    return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
  }

  return NextResponse.json({ data: { id } });
}
