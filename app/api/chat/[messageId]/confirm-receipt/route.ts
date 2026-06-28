import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessage,
  isReceiptSplitCard,
  mapReceiptLineToExpenseCategory,
  updateChatMessageCardData,
  type ChatReceiptCardData,
} from "@/lib/chat-queries";
import { createExpense } from "@/lib/queries";
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

  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const entryIds: string[] = [];

  for (const item of card.items) {
    if (!item.selected) continue;

    const entry = await createExpense(user.id, {
      amount: parseFloat(item.amount),
      category: mapReceiptLineToExpenseCategory(item.category),
      paymentMethod: card.paymentMethod,
      note: item.note,
      entryDate: card.entryDate,
    });
    entryIds.push(entry.id);
  }

  const updatedCard: ChatReceiptCardData = {
    ...card,
    status: "confirmed",
    entryIds,
  };

  await updateChatMessageCardData(user.id, messageId, updatedCard);

  return NextResponse.json({ data: { ok: true, entryIds } });
}
