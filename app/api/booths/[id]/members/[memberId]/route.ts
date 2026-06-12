import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { boothMemberPatchSchema } from "@/lib/booth-validation";
import { boothMemberErrorResponse } from "@/lib/booth-errors";
import { deleteBoothMember, updateBoothMember } from "@/lib/booth-queries";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id, memberId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = boothMemberPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const result = await updateBoothMember(userId, id, memberId, parsed.data);
  if (!result.ok) {
    const { status, body: errBody } = boothMemberErrorResponse(result.reason);
    return NextResponse.json(errBody, { status });
  }

  return NextResponse.json({ data: result.member });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id, memberId } = await ctx.params;
  const ok = await deleteBoothMember(userId, id, memberId);
  if (!ok) {
    return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
  }

  return NextResponse.json({ data: { id: memberId } });
}
