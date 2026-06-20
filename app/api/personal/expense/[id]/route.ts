import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { deletePersonalExpense } from "@/lib/personal-queries";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;
  const removed = await deletePersonalExpense(userId, id);
  if (!removed) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }
  return NextResponse.json({ data: { id } });
}
