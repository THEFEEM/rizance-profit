import { NextRequest, NextResponse } from "next/server";
import {
  categoryLabelOf,
  getChatMessage,
  updateChatCardCategory,
} from "@/lib/chat-queries";
import {
  isExpenseCategoryKey,
  isIncomeCategoryKey,
} from "@/lib/expense-categories";
import { updateExpenseCategory, updateIncomeCategory } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export async function POST(
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

  const { category } = body as { category?: unknown };
  if (typeof category !== "string" || category.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const msg = await getChatMessage(user.id, messageId);
  if (!msg || !msg.entryId || !msg.entryKind || !msg.cardData) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const kind = msg.entryKind;
  if (kind === "income") {
    if (!isIncomeCategoryKey(category)) {
      return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
    }
  } else if (!isExpenseCategoryKey(category)) {
    return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
  }

  const updated =
    kind === "income"
      ? await updateIncomeCategory(user.id, msg.entryId, category)
      : await updateExpenseCategory(user.id, msg.entryId, category);

  if (!updated) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  const categoryLabel = categoryLabelOf(kind, category);
  await updateChatCardCategory(user.id, messageId, category, categoryLabel);

  return NextResponse.json({ data: { ok: true, category, categoryLabel } });
}
