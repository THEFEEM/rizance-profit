import { NextRequest, NextResponse } from "next/server";
import {
  getPersonalChatMessage,
  personalCategoryLabelOf,
  updatePersonalChatCardCategory,
  updatePersonalExpenseCategory,
  updatePersonalIncomeCategory,
} from "@/lib/personal-chat-queries";
import {
  isPersonalExpenseKey,
  isPersonalIncomeKey,
} from "@/lib/personal-categories";
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

  const msg = await getPersonalChatMessage(user.id, messageId);
  if (!msg || !msg.entryId || !msg.entryKind || !msg.cardData) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const kind = msg.entryKind;
  if (kind === "income") {
    if (!isPersonalIncomeKey(category)) {
      return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
    }
  } else if (!isPersonalExpenseKey(category)) {
    return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
  }

  const updated =
    kind === "income"
      ? await updatePersonalIncomeCategory(user.id, msg.entryId, category)
      : await updatePersonalExpenseCategory(user.id, msg.entryId, category);

  if (!updated) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  const categoryLabel = personalCategoryLabelOf(kind, category);
  await updatePersonalChatCardCategory(user.id, messageId, category, categoryLabel);

  return NextResponse.json({ data: { ok: true, category, categoryLabel } });
}
