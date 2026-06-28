import { NextRequest, NextResponse } from "next/server";
import {
  CATEGORY_LABELS,
  getChatMessage,
  isReceiptSplitCard,
  RECEIPT_ITEM_CATEGORY_KEYS,
  updateChatMessageCardData,
} from "@/lib/chat-queries";
import { getCurrentUser } from "@/lib/session";

const VALID_RECEIPT_CATEGORIES = new Set<string>(RECEIPT_ITEM_CATEGORY_KEYS);

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

  const { itemId, category } = body as { itemId?: unknown; category?: unknown };
  if (typeof itemId !== "string" || itemId.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }
  if (typeof category !== "string" || !VALID_RECEIPT_CATEGORIES.has(category)) {
    return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
  }

  const msg = await getChatMessage(user.id, messageId);
  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const hasItem = card.items.some((item) => item.id === itemId);
  if (!hasItem) {
    return NextResponse.json({ error: { message: "Item not found" } }, { status: 404 });
  }

  const categoryLabel = CATEGORY_LABELS[category] ?? "อื่นๆ";
  const updatedItems = card.items.map((item) =>
    item.id === itemId ? { ...item, category, categoryLabel } : item,
  );

  await updateChatMessageCardData(user.id, messageId, {
    ...card,
    items: updatedItems,
  });

  return NextResponse.json({ data: { ok: true, category, categoryLabel } });
}
