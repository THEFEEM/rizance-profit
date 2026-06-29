import { query } from "@/lib/db";
import { parseCardPayload } from "@/lib/chat-queries";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import type { ChatCardPayload, ChatMessageRow } from "@/lib/chat-types";

export type BoothChatMessageRow = ChatMessageRow;

type BoothChatDbRow = {
  id: string;
  role: string;
  content: string;
  image_thumb: string | null;
  entry_id: string | null;
  entry_kind: string | null;
  card_data: unknown;
  created_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: BoothChatDbRow): BoothChatMessageRow {
  const role = row.role === "assistant" ? "assistant" : "user";
  const entryKind =
    row.entry_kind === "income" || row.entry_kind === "expense"
      ? row.entry_kind
      : null;

  return {
    id: row.id,
    role,
    content: row.content || null,
    imageThumb: row.image_thumb,
    entryId: row.entry_id,
    entryKind,
    cardData: parseCardPayload(row.card_data),
    createdAt: toIso(row.created_at),
  };
}

export function boothCategoryLabelOf(
  kind: "income" | "expense",
  category: string,
): string {
  return kind === "income"
    ? incomeCategoryLabel(category as IncomeCategoryKey)
    : expenseCategoryLabel(category as ExpenseCategoryKey);
}

export function normalizeBoothIncomeCategory(
  category: string | null,
  fallback: IncomeCategoryKey = "storefront",
): IncomeCategoryKey {
  return normalizeIncomeCategory(category, fallback);
}

export function normalizeBoothExpenseCategory(
  category: string | null,
  fallback: ExpenseCategoryKey = "expense_misc",
): ExpenseCategoryKey {
  return normalizeExpenseCategory(category ?? fallback);
}

export async function getBoothChatMessages(
  userId: string,
  boothId: string,
  limit = 50,
): Promise<BoothChatMessageRow[]> {
  const { rows } = await query<BoothChatDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM booth_chat_messages
     WHERE booth_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [boothId, userId, limit],
  );
  return rows.map(mapRow).reverse();
}

export async function insertBoothChatMessage(
  userId: string,
  boothId: string,
  input: {
    role: "user" | "assistant";
    content?: string | null;
    imageThumb?: string | null;
    entryId?: string | null;
    entryKind?: "income" | "expense" | null;
    cardData?: ChatCardPayload | null;
  },
): Promise<BoothChatMessageRow> {
  const { rows } = await query<BoothChatDbRow>(
    `INSERT INTO booth_chat_messages
       (booth_id, user_id, role, content, entry_id, entry_kind, card_data, image_thumb)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at`,
    [
      boothId,
      userId,
      input.role,
      input.content ?? "",
      input.entryId ?? null,
      input.entryKind ?? null,
      input.cardData ? JSON.stringify(input.cardData) : null,
      input.imageThumb ?? null,
    ],
  );
  return mapRow(rows[0]);
}
