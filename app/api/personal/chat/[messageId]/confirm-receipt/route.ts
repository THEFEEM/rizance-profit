import { NextRequest, NextResponse } from "next/server";
import { isReceiptSplitCard } from "@/lib/chat-types";
import {
  confirmPersonalReceipt,
  getPersonalChatMessage,
  normalizePersonalExpenseCategory,
  type PersonalExpenseBatchItem,
} from "@/lib/personal-chat-queries";
import { mapReceiptLineToPersonalExpenseCategory } from "@/lib/personal-categories";
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

  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const selectedItems = card.items.filter((item) => item.selected);
  const batchItems: PersonalExpenseBatchItem[] = [];

  for (const item of selectedItems) {
    const amount = parseFloat(item.amount);
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: { message: `amount ไม่ถูกต้อง: ${item.note}` } },
        { status: 400 },
      );
    }

    const category = normalizePersonalExpenseCategory(
      mapReceiptLineToPersonalExpenseCategory(item.category),
    );

    batchItems.push({
      amount: amount.toFixed(2),
      category,
      note: item.note ?? null,
      entryDate: card.entryDate,
    });
  }

  const entryIds = await confirmPersonalReceipt(user.id, messageId, batchItems, card);

  return NextResponse.json({ data: { ok: true, entryIds } });
}
