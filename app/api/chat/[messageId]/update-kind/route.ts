import { NextRequest, NextResponse } from "next/server";
import {
  categoryLabelOf,
  getChatMessage,
  isReceiptSplitCard,
} from "@/lib/chat-queries";
import type { ChatCardData } from "@/lib/chat-types";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

type EntryKind = "income" | "expense";

type EntrySnapshot = {
  amount: string;
  payment_method: string;
  note: string | null;
  entry_date: string;
};

type EntryIdRow = { id: string };

function isEntryKind(value: unknown): value is EntryKind {
  return value === "income" || value === "expense";
}

const INCOME_DEFAULT_CATEGORY = "storefront";
const EXPENSE_DEFAULT_CATEGORY = "expense_misc";

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

  const { kind } = body as { kind?: unknown };
  if (!isEntryKind(kind)) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const msg = await getChatMessage(user.id, messageId);
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

    let snapshot: EntrySnapshot;

    if (currentKind === "income") {
      const { rows } = await client.query<EntrySnapshot>(
        `SELECT amount::text, payment_method, note, entry_date::text AS entry_date
         FROM income_entries WHERE id = $1 AND user_id = $2`,
        [msg.entryId, user.id],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
      }
      snapshot = rows[0];

      const { rowCount } = await client.query(
        `DELETE FROM income_entries WHERE id = $1 AND user_id = $2`,
        [msg.entryId, user.id],
      );
      if ((rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
      }

      const { rows: inserted } = await client.query<EntryIdRow>(
        `INSERT INTO expense_entries (user_id, amount, category, payment_method, note, entry_date, is_advance, payer_name, payer_kind)
         VALUES ($1, $2, $3, $4, $5, $6::date, false, null, null)
         RETURNING id`,
        [
          user.id,
          snapshot.amount,
          EXPENSE_DEFAULT_CATEGORY,
          snapshot.payment_method,
          snapshot.note,
          snapshot.entry_date,
        ],
      );

      const newEntryId = inserted[0].id;
      const categoryLabel = categoryLabelOf("expense", EXPENSE_DEFAULT_CATEGORY);
      const updatedCard: ChatCardData = {
        ...card,
        kind: "expense",
        category: EXPENSE_DEFAULT_CATEGORY,
        categoryLabel,
      };

      await client.query(
        `UPDATE chat_messages
         SET entry_id = $1, entry_kind = $2, card_data = $3::jsonb
         WHERE id = $4 AND user_id = $5`,
        [newEntryId, "expense", JSON.stringify(updatedCard), messageId, user.id],
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

    const { rows } = await client.query<EntrySnapshot>(
      `SELECT amount::text, payment_method, note, entry_date::text AS entry_date
       FROM expense_entries WHERE id = $1 AND user_id = $2`,
      [msg.entryId, user.id],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
    }
    snapshot = rows[0];

    const { rowCount } = await client.query(
      `DELETE FROM expense_entries WHERE id = $1 AND user_id = $2`,
      [msg.entryId, user.id],
    );
    if ((rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: { message: "Entry not found" } }, { status: 404 });
    }

    const { rows: inserted } = await client.query<EntryIdRow>(
      `INSERT INTO income_entries (user_id, amount, category, payment_method, note, entry_date)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING id`,
      [
        user.id,
        snapshot.amount,
        INCOME_DEFAULT_CATEGORY,
        snapshot.payment_method,
        snapshot.note,
        snapshot.entry_date,
      ],
    );

    const newEntryId = inserted[0].id;
    const categoryLabel = categoryLabelOf("income", INCOME_DEFAULT_CATEGORY);
    const updatedCard: ChatCardData = {
      ...card,
      kind: "income",
      category: INCOME_DEFAULT_CATEGORY,
      categoryLabel,
    };

    await client.query(
      `UPDATE chat_messages
       SET entry_id = $1, entry_kind = $2, card_data = $3::jsonb
       WHERE id = $4 AND user_id = $5`,
      [newEntryId, "income", JSON.stringify(updatedCard), messageId, user.id],
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
