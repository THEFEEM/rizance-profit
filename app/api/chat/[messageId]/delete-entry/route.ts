import { NextRequest, NextResponse } from "next/server";
import { getChatMessage, markChatEntryDeleted } from "@/lib/chat-queries";
import { deleteExpense, deleteIncome } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { messageId } = await ctx.params;
  const msg = await getChatMessage(user.id, messageId);

  if (!msg || !msg.entryId || !msg.entryKind) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const removed =
    msg.entryKind === "income"
      ? await deleteIncome(user.id, msg.entryId)
      : await deleteExpense(user.id, msg.entryId);

  if (!removed) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  await markChatEntryDeleted(user.id, messageId);

  return NextResponse.json({ data: { ok: true } });
}
