import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessage,
  isReceiptSplitCard,
  mapReceiptLineToExpenseCategory,
  type ChatReceiptCardData,
} from "@/lib/chat-queries";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

type ExpenseIdRow = { id: string };

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

  const selectedItems = card.items.filter((item) => item.selected);
  const parsedAmounts: { item: (typeof selectedItems)[number]; amount: number }[] = [];

  for (const item of selectedItems) {
    const amount = parseFloat(item.amount);
    if (isNaN(amount) || amount <= 0) {
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
      const { rows } = await client.query<ExpenseIdRow>(
        `INSERT INTO expense_entries (user_id, amount, category, payment_method, note, entry_date, is_advance, payer_name, payer_kind)
         VALUES ($1, $2, $3, $4, $5, $6::date, false, null, null)
         RETURNING id`,
        [
          user.id,
          amount.toFixed(2),
          mapReceiptLineToExpenseCategory(item.category),
          card.paymentMethod,
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
      `UPDATE chat_messages SET card_data = $1::jsonb WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(updatedCard), messageId, user.id],
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
