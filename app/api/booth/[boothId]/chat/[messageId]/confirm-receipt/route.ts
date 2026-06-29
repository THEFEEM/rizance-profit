import { NextRequest, NextResponse } from "next/server";
import {
  getBoothChatMessage,
  isReceiptSplitCard,
  mapReceiptLineToExpenseCategory,
} from "@/lib/booth-chat-queries";
import type { ChatReceiptCardData } from "@/lib/chat-types";
import { isFixed } from "@/lib/expense-categories";
import { pool } from "@/lib/db";
import { getBooth } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";

type ExpenseIdRow = { id: string };

type RouteContext = { params: Promise<{ boothId: string; messageId: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { boothId, messageId } = await context.params;
  const booth = await getBooth(user.id, boothId);
  if (!booth) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const msg = await getBoothChatMessage(user.id, boothId, messageId);
  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const selectedItems = card.items.filter((item) => item.selected);
  const parsedAmounts: { item: (typeof selectedItems)[number]; amount: number }[] = [];

  for (const item of selectedItems) {
    const amount = parseFloat(item.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: { message: `amount ไม่ถูกต้อง: ${item.note}` } },
        { status: 400 },
      );
    }
    parsedAmounts.push({ item, amount });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const entryIds: string[] = [];

    for (const { item, amount } of parsedAmounts) {
      const category = mapReceiptLineToExpenseCategory(item.category);
      const costType = isFixed(category) ? "fixed" : "variable";
      const { rows } = await client.query<ExpenseIdRow>(
        `INSERT INTO booth_expense_entries
           (booth_id, user_id, amount, cost_type, category, label, note, entry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
         RETURNING id`,
        [
          boothId,
          user.id,
          amount.toFixed(2),
          costType,
          category,
          null,
          item.note ?? null,
          card.entryDate,
        ],
      );
      entryIds.push(rows[0].id);
    }

    const updatedCard: ChatReceiptCardData = {
      ...card,
      status: "confirmed",
      entryIds,
    };

    await client.query(
      `UPDATE booth_chat_messages SET card_data = $1::jsonb
       WHERE id = $2 AND booth_id = $3 AND user_id = $4`,
      [JSON.stringify(updatedCard), messageId, boothId, user.id],
    );

    await client.query("COMMIT");

    return NextResponse.json({ data: { ok: true, entryIds } });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
