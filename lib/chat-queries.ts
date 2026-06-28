import { query } from "@/lib/db";
import {
  CATEGORY_LABELS,
  type ChatCardData,
  type ChatCardPayload,
  type ChatMessageRow,
  type ChatReceiptCardData,
  type ReceiptLineItem,
} from "@/lib/chat-types";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";

export {
  CATEGORY_LABELS,
  isReceiptSplitCard,
  RECEIPT_ITEM_CATEGORY_KEYS,
  type ChatCardData,
  type ChatCardPayload,
  type ChatMessageRow,
  type ChatReceiptCardData,
  type ReceiptItemCategoryKey,
  type ReceiptLineItem,
} from "@/lib/chat-types";

export function parseCardPayload(raw: unknown): ChatCardPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  if (data.cardType === "receipt_split") {
    return data as ChatReceiptCardData;
  }

  return data as ChatCardData;
}

export function buildReceiptCardData(
  result: import("./ai-slip").ReceiptScanResult,
  fallbackDate: string,
): ChatReceiptCardData {
  const items: ReceiptLineItem[] = result.items.map((item) => {
    const category = item.category ?? "other";
    return {
      id: item.id,
      note: item.note,
      amount: item.amount.toFixed(2),
      category,
      categoryLabel: CATEGORY_LABELS[category] ?? "อื่นๆ",
      confidence: item.confidence,
      selected: true,
    };
  });

  const itemsSum = items
    .reduce((sum, item) => sum + parseFloat(item.amount), 0)
    .toFixed(2);

  return {
    cardType: "receipt_split",
    kind: "expense",
    merchantName: result.merchantName,
    entryDate: result.entryDate ?? fallbackDate,
    paymentMethod: result.paymentMethod ?? "cash",
    totalAmount: result.totalAmount?.toFixed(2) ?? itemsSum,
    itemsSum,
    status: "pending",
    items,
    confidence: result.confidence,
  };
}

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

function mapCardData(raw: unknown): ChatCardPayload | null {
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

  if (record.cardType === "receipt_split") {
    return record as ChatReceiptCardData;
  }

  return parseCardData(obj);
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
    cardData: mapCardData(row.card_data),
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
    cardData?: ChatCardPayload | null;
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

export async function updateChatMessageCardData(
  userId: string,
  messageId: string,
  cardData: ChatCardPayload,
): Promise<void> {
  await query(
    `UPDATE chat_messages SET card_data = $1::jsonb WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(cardData), messageId, userId],
  );
}

export async function deleteChatMessage(
  userId: string,
  messageId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM chat_messages WHERE id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export function mapReceiptLineToExpenseCategory(category: string): ExpenseCategoryKey {
  const map: Record<string, ExpenseCategoryKey> = {
    materials: "materials",
    equipment: "equipment",
    utilities: "utilities",
    beverages: "materials",
    packaging: "materials",
    food: "materials",
    other: "expense_misc",
    salary: "wage",
    marketing: "marketing",
    rent: "rent",
    transport: "shipping",
  };
  return map[category] ?? "expense_misc";
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
