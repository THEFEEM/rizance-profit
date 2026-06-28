import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessage,
  isReceiptSplitCard,
  updateChatMessageCardData,
} from "@/lib/chat-queries";
import type { ChatCardData } from "@/lib/chat-types";
import {
  updateExpensePaymentMethod,
  updateIncomePaymentMethod,
} from "@/lib/queries";
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
  if (
    !msg ||
    !msg.entryId ||
    !msg.entryKind ||
    !msg.cardData ||
    isReceiptSplitCard(msg.cardData)
  ) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const kind = msg.entryKind;
  const updated =
    kind === "income"
      ? await updateIncomePaymentMethod(user.id, msg.entryId, paymentMethod)
      : await updateExpensePaymentMethod(user.id, msg.entryId, paymentMethod);

  if (!updated) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  const updatedCard: ChatCardData = {
    ...(msg.cardData as ChatCardData),
    paymentMethod,
  };
  await updateChatMessageCardData(user.id, messageId, updatedCard);

  return NextResponse.json({ data: { ok: true, paymentMethod } });
}
