import { NextRequest, NextResponse } from "next/server";
import {
  boothCategoryLabelOf,
  getBoothChatMessage,
  isReceiptSplitCard,
} from "@/lib/booth-chat-queries";
import type { ChatCardData } from "@/lib/chat-types";
import { isFixed } from "@/lib/expense-categories";
import { pool } from "@/lib/db";
import { getBooth } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";

type EntryKind = "income" | "expense";

type IncomeSnapshot = {
  amount: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
};

type ExpenseSnapshot = {
  amount: string;
  note: string | null;
  entry_date: string;
};

type EntryIdRow = { id: string };

function isEntryKind(value: unknown): value is EntryKind {
  return value === "income" || value === "expense";
}

const INCOME_DEFAULT_CATEGORY = "storefront";
const EXPENSE_DEFAULT_CATEGORY = "expense_misc";

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

  const { kind } = body as { kind?: unknown };
  if (!isEntryKind(kind)) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const msg = await getBoothChatMessage(user.id, boothId, messageId);
  if (!msg || !msg.entryId || !msg.entryKind || !msg.cardData) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  if (isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  const card = msg.cardData as ChatCardData;
  const currentKind = msg.entryKind;

  if (kind === currentKind) {
    return NextResponse.json({
      data: {
        ok: true,
        entryId: msg.entryId,
        kind,
        category: card.category,
        categoryLabel: card.categoryLabel,
      },
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (currentKind === "income") {
      const { rows } = await client.query<IncomeSnapshot>(
        `SELECT amount::text, payment_method, note, entry_date::text AS entry_date
         FROM booth_income_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
        [msg.entryId, boothId, user.id],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
      }
      const snapshot = rows[0];

      const { rowCount } = await client.query(
        `DELETE FROM booth_income_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
        [msg.entryId, boothId, user.id],
      );
      if ((rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
      }

      const costType = isFixed(EXPENSE_DEFAULT_CATEGORY) ? "fixed" : "variable";
      const { rows: inserted } = await client.query<EntryIdRow>(
        `INSERT INTO booth_expense_entries
           (booth_id, user_id, amount, cost_type, category, label, note, entry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
         RETURNING id`,
        [
          boothId,
          user.id,
          snapshot.amount,
          costType,
          EXPENSE_DEFAULT_CATEGORY,
          null,
          snapshot.note,
          snapshot.entry_date,
        ],
      );

      const newEntryId = inserted[0].id;
      const categoryLabel = boothCategoryLabelOf("expense", EXPENSE_DEFAULT_CATEGORY);
      const updatedCard: ChatCardData = {
        ...card,
        kind: "expense",
        category: EXPENSE_DEFAULT_CATEGORY,
        categoryLabel,
      };

      await client.query(
        `UPDATE booth_chat_messages
         SET entry_id = $1, entry_kind = $2, card_data = $3::jsonb
         WHERE id = $4 AND booth_id = $5 AND user_id = $6`,
        [newEntryId, "expense", JSON.stringify(updatedCard), messageId, boothId, user.id],
      );

      await client.query("COMMIT");

      return NextResponse.json({
        data: {
          ok: true,
          entryId: newEntryId,
          kind: "expense" as const,
          category: EXPENSE_DEFAULT_CATEGORY,
          categoryLabel,
        },
      });
    }

    const { rows } = await client.query<ExpenseSnapshot>(
      `SELECT amount::text, note, entry_date::text AS entry_date
       FROM booth_expense_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
      [msg.entryId, boothId, user.id],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
    }
    const snapshot = rows[0];

    const { rowCount } = await client.query(
      `DELETE FROM booth_expense_entries WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
      [msg.entryId, boothId, user.id],
    );
    if ((rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
    }

    const paymentMethod =
      card.paymentMethod === "transfer" ? "transfer" : "cash";

    const { rows: inserted } = await client.query<EntryIdRow>(
      `INSERT INTO booth_income_entries
         (booth_id, user_id, amount, category, payment_method, note, entry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date)
       RETURNING id`,
      [
        boothId,
        user.id,
        snapshot.amount,
        INCOME_DEFAULT_CATEGORY,
        paymentMethod,
        snapshot.note,
        snapshot.entry_date,
      ],
    );

    const newEntryId = inserted[0].id;
    const categoryLabel = boothCategoryLabelOf("income", INCOME_DEFAULT_CATEGORY);
    const updatedCard: ChatCardData = {
      ...card,
      kind: "income",
      category: INCOME_DEFAULT_CATEGORY,
      categoryLabel,
      paymentMethod,
    };

    await client.query(
      `UPDATE booth_chat_messages
       SET entry_id = $1, entry_kind = $2, card_data = $3::jsonb
       WHERE id = $4 AND booth_id = $5 AND user_id = $6`,
      [newEntryId, "income", JSON.stringify(updatedCard), messageId, boothId, user.id],
    );

    await client.query("COMMIT");

    return NextResponse.json({
      data: {
        ok: true,
        entryId: newEntryId,
        kind: "income" as const,
        category: INCOME_DEFAULT_CATEGORY,
        categoryLabel,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
