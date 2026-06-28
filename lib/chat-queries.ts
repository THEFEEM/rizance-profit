import { query } from "@/lib/db";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";

export type ChatCardData = {
  kind: "income" | "expense";
  amount: string;
  category: string;
  categoryLabel: string;
  paymentMethod: "cash" | "transfer";
  note: string | null;
  entryDate: string;
  confidence: "low" | "medium" | "high";
};

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string | null;
  imageThumb: string | null;
  entryId: string | null;
  entryKind: "income" | "expense" | null;
  cardData: ChatCardData | null;
  createdAt: string;
};

type ChatMessageDbRow = {
  id: string;
  role: string;
  content: string | null;
  image_thumb: string | null;
  entry_id: string | null;
  entry_kind: string | null;
  card_data: unknown;
  created_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isConfidence(value: unknown): value is ChatCardData["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

function isPaymentMethod(value: unknown): value is ChatCardData["paymentMethod"] {
  return value === "cash" || value === "transfer";
}

function parseCardData(raw: unknown): ChatCardData | null {
  if (raw == null) return null;

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;

  if (record.kind !== "income" && record.kind !== "expense") return null;
  if (typeof record.amount !== "string") return null;
  if (typeof record.category !== "string") return null;
  if (typeof record.categoryLabel !== "string") return null;
  if (!isPaymentMethod(record.paymentMethod)) return null;
  if (typeof record.entryDate !== "string") return null;
  if (!isConfidence(record.confidence)) return null;

  return {
    kind: record.kind,
    amount: record.amount,
    category: record.category,
    categoryLabel: record.categoryLabel,
    paymentMethod: record.paymentMethod,
    note: typeof record.note === "string" ? record.note : null,
    entryDate: record.entryDate,
    confidence: record.confidence,
  };
}

function mapRow(row: ChatMessageDbRow): ChatMessageRow {
  const role = row.role === "assistant" ? "assistant" : "user";
  const entryKind =
    row.entry_kind === "income" || row.entry_kind === "expense"
      ? row.entry_kind
      : null;

  return {
    id: row.id,
    role,
    content: row.content,
    imageThumb: row.image_thumb,
    entryId: row.entry_id,
    entryKind,
    cardData: parseCardData(row.card_data),
    createdAt: toIso(row.created_at),
  };
}

export async function insertChatMessage(
  userId: string,
  input: {
    role: "user" | "assistant";
    content?: string | null;
    imageThumb?: string | null;
    entryId?: string | null;
    entryKind?: "income" | "expense" | null;
    cardData?: ChatCardData | null;
  },
): Promise<ChatMessageRow> {
  const { rows } = await query<ChatMessageDbRow>(
    `INSERT INTO chat_messages (user_id, role, content, image_thumb, entry_id, entry_kind, card_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at`,
    [
      userId,
      input.role,
      input.content ?? null,
      input.imageThumb ?? null,
      input.entryId ?? null,
      input.entryKind ?? null,
      input.cardData ? JSON.stringify(input.cardData) : null,
    ],
  );
  return mapRow(rows[0]);
}

export async function listChatMessages(
  userId: string,
  limit = 50,
): Promise<ChatMessageRow[]> {
  const { rows } = await query<ChatMessageDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM chat_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapRow).reverse();
}

export async function getChatMessage(
  userId: string,
  messageId: string,
): Promise<ChatMessageRow | null> {
  const { rows } = await query<ChatMessageDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM chat_messages
     WHERE id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function markChatEntryDeleted(
  userId: string,
  messageId: string,
): Promise<void> {
  await query(
    `UPDATE chat_messages
     SET entry_id = NULL
     WHERE id = $1 AND user_id = $2`,
    [messageId, userId],
  );
}

export async function updateChatCardCategory(
  userId: string,
  messageId: string,
  category: string,
  categoryLabel: string,
): Promise<void> {
  await query(
    `UPDATE chat_messages
     SET card_data = jsonb_set(
       jsonb_set(card_data, '{category}', $3::jsonb),
       '{categoryLabel}', $4::jsonb
     )
     WHERE id = $1 AND user_id = $2`,
    [messageId, userId, JSON.stringify(category), JSON.stringify(categoryLabel)],
  );
}

export function categoryLabelOf(
  kind: "income" | "expense",
  category: string,
): string {
  return kind === "income"
    ? incomeCategoryLabel(category)
    : expenseCategoryLabel(category);
}

export function resolveEntryCategory(
  kind: "income" | "expense",
  category: string | null,
): IncomeCategoryKey | ExpenseCategoryKey {
  if (kind === "income") {
    return normalizeIncomeCategory(category, "other_income");
  }
  return normalizeExpenseCategory(category, "expense_misc");
}
