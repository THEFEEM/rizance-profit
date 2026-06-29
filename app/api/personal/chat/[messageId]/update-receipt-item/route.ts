import { NextRequest, NextResponse } from "next/server";
import { isReceiptSplitCard } from "@/lib/chat-types";
import {
  getPersonalChatMessage,
  updatePersonalChatMessageCardData,
} from "@/lib/personal-chat-queries";
import {
  isPersonalExpenseKey,
  PERSONAL_RECEIPT_EXPENSE_KEYS,
  personalExpenseLabel,
} from "@/lib/personal-categories";
import { getCurrentUser } from "@/lib/session";

const VALID_RECEIPT_CATEGORIES = new Set<string>(PERSONAL_RECEIPT_EXPENSE_KEYS);

function recalculateItemsSum(
  items: { amount: string; selected: boolean }[],
): string {
  return items
    .reduce((sum, item) => sum + parseFloat(item.amount), 0)
    .toFixed(2);
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

  const { itemId, category, note, amount } = body as {
    itemId?: unknown;
    category?: unknown;
    note?: unknown;
    amount?: unknown;
  };

  if (typeof itemId !== "string" || itemId.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const hasCategory = category !== undefined;
  const hasNote = note !== undefined;
  const hasAmount = amount !== undefined;

  if (!hasCategory && !hasNote && !hasAmount) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  if (hasCategory) {
    if (
      typeof category !== "string" ||
      !VALID_RECEIPT_CATEGORIES.has(category) ||
      !isPersonalExpenseKey(category)
    ) {
      return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
    }
  }

  let parsedNote: string | undefined;
  if (hasNote) {
    if (typeof note !== "string") {
      return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
    }
    parsedNote = note.trim();
    if (parsedNote === "") {
      return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
    }
  }

  let parsedAmount: string | undefined;
  if (hasAmount) {
    const num =
      typeof amount === "number"
        ? amount
        : typeof amount === "string"
          ? parseFloat(amount)
          : NaN;
    if (!Number.isFinite(num) || num <= 0) {
      return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
    }
    parsedAmount = num.toFixed(2);
  }

  const msg = await getPersonalChatMessage(user.id, messageId);
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

  const updatedItems = card.items.map((item) => {
    if (item.id !== itemId) return item;

    const next = { ...item };
    if (hasCategory && typeof category === "string") {
      next.category = category;
      next.categoryLabel = personalExpenseLabel(category);
    }
    if (parsedNote !== undefined) {
      next.note = parsedNote;
    }
    if (parsedAmount !== undefined) {
      next.amount = parsedAmount;
    }
    return next;
  });

  const itemsSum = recalculateItemsSum(updatedItems);

  await updatePersonalChatMessageCardData(user.id, messageId, {
    ...card,
    items: updatedItems,
    itemsSum,
  });

  return NextResponse.json({ data: { ok: true, itemsSum } });
}
