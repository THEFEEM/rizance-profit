import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { deleteSavingsGoal } from "@/lib/personal-queries";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await params;
  const ok = await deleteSavingsGoal(userId, id);
  if (!ok) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  return NextResponse.json({ data: { ok: true } });
}
