import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { deleteExpense } from "@/lib/queries";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;
  const removed = await deleteExpense(userId, id);
  if (!removed) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }
  return NextResponse.json({ data: { id } });
}
