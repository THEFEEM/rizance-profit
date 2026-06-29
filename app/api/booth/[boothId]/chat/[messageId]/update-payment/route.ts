import { NextRequest, NextResponse } from "next/server";
import {
  getBoothChatMessage,
  isReceiptSplitCard,
  updateBoothChatMessageCardData,
  updateBoothIncomePaymentMethod,
} from "@/lib/booth-chat-queries";
import type { ChatCardData } from "@/lib/chat-types";
import { getBooth } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";

function isPaymentMethod(value: unknown): value is "cash" | "transfer" {
  return value === "cash" || value === "transfer";
}

type RouteContext = { params: Promise<{ boothId: string; messageId: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { boothId, messageId } = await context.params;
  const booth = await getBooth(user.id, boothId);
  if (!booth) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

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

  const msg = await getBoothChatMessage(user.id, boothId, messageId);
  if (
    !msg ||
    !msg.entryId ||
    !msg.entryKind ||
    !msg.cardData ||
    isReceiptSplitCard(msg.cardData)
  ) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  if (msg.entryKind !== "income") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const updated = await updateBoothIncomePaymentMethod(
    user.id,
    boothId,
    msg.entryId,
    paymentMethod,
  );

  if (!updated) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  const updatedCard: ChatCardData = {
    ...(msg.cardData as ChatCardData),
    paymentMethod,
  };
  await updateBoothChatMessageCardData(user.id, boothId, messageId, updatedCard);

  return NextResponse.json({ data: { ok: true, paymentMethod } });
}
