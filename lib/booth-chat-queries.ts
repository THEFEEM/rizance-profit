import { query } from "@/lib/db";
import {
  mapReceiptLineToExpenseCategory,
  parseCardPayload,
} from "@/lib/chat-queries";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
  isFixed,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import type { ChatCardPayload, ChatMessageRow } from "@/lib/chat-types";

export type BoothChatMessageRow = ChatMessageRow;

export { isReceiptSplitCard } from "@/lib/chat-types";

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

export async function getBoothChatMessage(
  userId: string,
  boothId: string,
  messageId: string,
): Promise<BoothChatMessageRow | null> {
  const { rows } = await query<BoothChatDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM booth_chat_messages
     WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
    [messageId, boothId, userId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateBoothChatMessageCardData(
  userId: string,
  boothId: string,
  messageId: string,
  cardData: ChatCardPayload,
): Promise<void> {
  await query(
    `UPDATE booth_chat_messages
     SET card_data = $1::jsonb
     WHERE id = $2 AND booth_id = $3 AND user_id = $4`,
    [JSON.stringify(cardData), messageId, boothId, userId],
  );
}

export async function updateBoothChatCardCategory(
  userId: string,
  boothId: string,
  messageId: string,
  category: string,
  categoryLabel: string,
): Promise<void> {
  await query(
    `UPDATE booth_chat_messages
     SET card_data = jsonb_set(
       jsonb_set(card_data, '{category}', $4::jsonb),
       '{categoryLabel}', $5::jsonb
     )
     WHERE id = $1 AND booth_id = $2 AND user_id = $3`,
    [messageId, boothId, userId, JSON.stringify(category), JSON.stringify(categoryLabel)],
  );
}

export async function updateBoothIncomeEntryCategory(
  userId: string,
  boothId: string,
  entryId: string,
  category: IncomeCategoryKey,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE booth_income_entries SET category = $1
     WHERE id = $2 AND booth_id = $3 AND user_id = $4`,
    [category, entryId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateBoothExpenseEntryCategory(
  userId: string,
  boothId: string,
  entryId: string,
  category: ExpenseCategoryKey,
): Promise<boolean> {
  const costType = isFixed(category) ? "fixed" : "variable";
  const { rowCount } = await query(
    `UPDATE booth_expense_entries SET category = $1, cost_type = $2
     WHERE id = $3 AND booth_id = $4 AND user_id = $5`,
    [category, costType, entryId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function updateBoothIncomePaymentMethod(
  userId: string,
  boothId: string,
  entryId: string,
  paymentMethod: "cash" | "transfer",
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE booth_income_entries SET payment_method = $1
     WHERE id = $2 AND booth_id = $3 AND user_id = $4`,
    [paymentMethod, entryId, boothId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export { mapReceiptLineToExpenseCategory };
