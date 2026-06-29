import { NextRequest, NextResponse } from "next/server";
import { isReceiptSplitCard } from "@/lib/chat-types";
import {
  deletePersonalChatMessage,
  deletePersonalExpense,
  deletePersonalExpensesBatch,
  deletePersonalIncome,
  getPersonalChatMessage,
} from "@/lib/personal-chat-queries";
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
  const msg = await getPersonalChatMessage(user.id, messageId);

  if (!msg) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  if (msg.cardData && isReceiptSplitCard(msg.cardData)) {
    const card = msg.cardData;
    if (card.entryIds?.length) {
      await deletePersonalExpensesBatch(user.id, card.entryIds);
    }
    await deletePersonalChatMessage(user.id, messageId);
    return NextResponse.json({ data: { ok: true } });
  }

  if (!msg.entryId || !msg.entryKind) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const removed =
    msg.entryKind === "income"
      ? await deletePersonalIncome(user.id, msg.entryId)
      : await deletePersonalExpense(user.id, msg.entryId);

  if (!removed) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  await deletePersonalChatMessage(user.id, messageId);

  return NextResponse.json({ data: { ok: true } });
}
