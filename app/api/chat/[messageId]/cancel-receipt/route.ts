import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessage,
  isReceiptSplitCard,
  updateChatMessageCardData,
} from "@/lib/chat-queries";
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

  await updateChatMessageCardData(user.id, messageId, {
    ...card,
    status: "cancelled",
  });

  return NextResponse.json({ data: { ok: true } });
}
