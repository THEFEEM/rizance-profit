import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { deleteBoothExpense, getBooth } from "@/lib/booth-queries";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; entryId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id, entryId } = await ctx.params;
  const booth = await getBooth(userId, id);
  if (!booth) return NextResponse.json({ error: { message: "ไม่พบงานบูธนี้" } }, { status: 404 });

  const removed = await deleteBoothExpense(userId, id, entryId);
  if (!removed) {
    return NextResponse.json({ error: { message: "ไม่พบรายการ" } }, { status: 404 });
  }
  return NextResponse.json({ data: { id: entryId } });
}
