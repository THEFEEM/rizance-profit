import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessage,
  isReceiptSplitCard,
  updateChatMessageCardData,
} from "@/lib/chat-queries";
import type { ChatReceiptCardData } from "@/lib/chat-types";
import { getCurrentUser } from "@/lib/session";

function isPaymentMethod(value: unknown): value is "cash" | "transfer" {
  return value === "cash" || value === "transfer";
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { messageId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const { paymentMethod } = body as { paymentMethod?: unknown };
  if (!isPaymentMethod(paymentMethod)) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const msg = await getChatMessage(user.id, messageId);
  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const updatedCard: ChatReceiptCardData = {
    ...card,
    paymentMethod,
  };
  await updateChatMessageCardData(user.id, messageId, updatedCard);

  return NextResponse.json({ data: { ok: true, paymentMethod } });
}
