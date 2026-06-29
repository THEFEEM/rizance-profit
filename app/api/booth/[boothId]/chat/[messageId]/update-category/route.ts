import { NextRequest, NextResponse } from "next/server";
import {
  boothCategoryLabelOf,
  getBoothChatMessage,
  updateBoothChatCardCategory,
  updateBoothExpenseEntryCategory,
  updateBoothIncomeEntryCategory,
} from "@/lib/booth-chat-queries";
import {
  isExpenseCategoryKey,
  isIncomeCategoryKey,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import { getBooth } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";

type RouteContext = { params: Promise<{ boothId: string; messageId: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
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

  const { category } = body as { category?: unknown };
  if (typeof category !== "string" || category.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const msg = await getBoothChatMessage(user.id, boothId, messageId);
  if (!msg || !msg.entryId || !msg.entryKind || !msg.cardData) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const kind = msg.entryKind;
  let updated: boolean;

  if (kind === "income") {
    if (!isIncomeCategoryKey(category)) {
      return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
    }
    updated = await updateBoothIncomeEntryCategory(
      user.id,
      boothId,
      msg.entryId,
      category as IncomeCategoryKey,
    );
  } else {
    if (!isExpenseCategoryKey(category)) {
      return NextResponse.json({ error: { message: "Invalid category" } }, { status: 400 });
    }
    updated = await updateBoothExpenseEntryCategory(
      user.id,
      boothId,
      msg.entryId,
      category as ExpenseCategoryKey,
    );
  }

  if (!updated) {
    return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
  }

  const categoryLabel = boothCategoryLabelOf(kind, category);
  await updateBoothChatCardCategory(user.id, boothId, messageId, category, categoryLabel);

  return NextResponse.json({ data: { ok: true, category, categoryLabel } });
}
