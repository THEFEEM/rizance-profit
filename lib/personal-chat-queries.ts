import { query, pool } from "@/lib/db";
import { parseCardPayload } from "@/lib/chat-queries";
import {
  type ChatCardPayload,
  type ChatMessageRow,
  type ChatReceiptCardData,
  type ReceiptLineItem,
} from "@/lib/chat-types";
import {
  isPersonalExpenseKey,
  isPersonalIncomeKey,
  mapReceiptLineToPersonalExpenseCategory,
  personalExpenseLabel,
  personalIncomeLabel,
  PERSONAL_SAVINGS_DEPOSIT,
  PERSONAL_SAVINGS_WITHDRAWAL,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";

export type PersonalChatMessageRow = ChatMessageRow;

type PersonalChatDbRow = {
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

function mapRow(row: PersonalChatDbRow): PersonalChatMessageRow {
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

export function personalCategoryLabelOf(
  kind: "income" | "expense",
  category: string,
): string {
  return kind === "income"
    ? personalIncomeLabel(category)
    : personalExpenseLabel(category);
}

export function normalizePersonalIncomeCategory(
  category: string | null,
  fallback: PersonalIncomeKey = "other_income",
): PersonalIncomeKey {
  if (
    category &&
    isPersonalIncomeKey(category) &&
    category !== PERSONAL_SAVINGS_WITHDRAWAL
  ) {
    return category;
  }
  return fallback;
}

export function normalizePersonalExpenseCategory(
  category: string | null,
  fallback: PersonalExpenseKey = "other_expense",
): PersonalExpenseKey {
  if (
    category &&
    isPersonalExpenseKey(category) &&
    category !== PERSONAL_SAVINGS_DEPOSIT
  ) {
    return category;
  }
  return fallback;
}

export function mapScanCategoryToPersonal(
  kind: "income" | "expense",
  shopCategory: string | null,
): PersonalIncomeKey | PersonalExpenseKey {
  if (kind === "income") {
    const map: Record<string, PersonalIncomeKey> = {
      storefront: "business",
      online: "business",
      delivery: "business",
      service: "freelance",
      other_income: "other_income",
      misc: "other_income",
    };
    return map[shopCategory ?? ""] ?? "other_income";
  }

  const map: Record<string, PersonalExpenseKey> = {
    rent: "rent",
    utilities: "electricity",
    materials: "food",
    equipment: "other_expense",
    shipping: "transport",
    marketing: "social",
    wage: "other_expense",
    expense_misc: "other_expense",
  };
  return map[shopCategory ?? ""] ?? "other_expense";
}

export function buildPersonalReceiptCardData(
  result: import("./ai-slip").ReceiptScanResult,
  fallbackDate: string,
): ChatReceiptCardData {
  const items: ReceiptLineItem[] = result.items.map((item) => {
    const category = mapReceiptLineToPersonalExpenseCategory(item.category);
    return {
      id: item.id,
      note: item.note,
      amount: item.amount.toFixed(2),
      category,
      categoryLabel: personalExpenseLabel(category),
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
    paymentMethod: "cash",
    totalAmount: result.totalAmount?.toFixed(2) ?? itemsSum,
    itemsSum,
    status: "pending",
    items,
    confidence: result.confidence,
  };
}

export type PersonalExpenseBatchItem = {
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
};

export async function confirmPersonalReceipt(
  userId: string,
  messageId: string,
  batchItems: PersonalExpenseBatchItem[],
  card: ChatReceiptCardData,
): Promise<string[]> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const entryIds: string[] = [];

    for (const item of batchItems) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO personal_expense_entries (user_id, amount, category, note, entry_date)
         VALUES ($1, $2, $3, $4, $5::date)
         RETURNING id`,
        [userId, item.amount, item.category, item.note, item.entryDate],
      );
      entryIds.push(rows[0].id);
    }

    const updatedCard: ChatReceiptCardData = {
      ...card,
      status: "confirmed",
      entryIds,
    };

    await client.query(
      `UPDATE personal_chat_messages
       SET card_data = $1::jsonb
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(updatedCard), messageId, userId],
    );

    await client.query("COMMIT");
    return entryIds;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createPersonalExpensesBatch(
  userId: string,
  items: PersonalExpenseBatchItem[],
): Promise<string[]> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const entryIds: string[] = [];

    for (const item of items) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO personal_expense_entries (user_id, amount, category, note, entry_date)
         VALUES ($1, $2, $3, $4, $5::date)
         RETURNING id`,
        [userId, item.amount, item.category, item.note, item.entryDate],
      );
      entryIds.push(rows[0].id);
    }

    await client.query("COMMIT");
    return entryIds;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePersonalExpensesBatch(
  userId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const id of ids) {
      await client.query(
        `DELETE FROM personal_expense_entries WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getPersonalChatMessages(
  userId: string,
  limit = 50,
): Promise<PersonalChatMessageRow[]> {
  const { rows } = await query<PersonalChatDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM personal_chat_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapRow).reverse();
}

export async function insertPersonalChatMessage(
  userId: string,
  input: {
    role: "user" | "assistant";
    content?: string | null;
    imageThumb?: string | null;
    entryId?: string | null;
    entryKind?: "income" | "expense" | null;
    cardData?: ChatCardPayload | null;
  },
): Promise<PersonalChatMessageRow> {
  const { rows } = await query<PersonalChatDbRow>(
    `INSERT INTO personal_chat_messages
       (user_id, role, content, entry_id, entry_kind, card_data, image_thumb)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at`,
    [
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

export async function getPersonalChatMessage(
  userId: string,
  messageId: string,
): Promise<PersonalChatMessageRow | null> {
  const { rows } = await query<PersonalChatDbRow>(
    `SELECT id, role, content, image_thumb, entry_id, entry_kind, card_data, created_at
     FROM personal_chat_messages
     WHERE id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updatePersonalChatMessageCardData(
  userId: string,
  messageId: string,
  cardData: ChatCardPayload,
): Promise<void> {
  await query(
    `UPDATE personal_chat_messages
     SET card_data = $1::jsonb
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(cardData), messageId, userId],
  );
}

export async function updatePersonalChatCardCategory(
  userId: string,
  messageId: string,
  category: string,
  categoryLabel: string,
): Promise<void> {
  await query(
    `UPDATE personal_chat_messages
     SET card_data = jsonb_set(
       jsonb_set(card_data, '{category}', $3::jsonb),
       '{categoryLabel}', $4::jsonb
     )
     WHERE id = $1 AND user_id = $2`,
    [messageId, userId, JSON.stringify(category), JSON.stringify(categoryLabel)],
  );
}

export async function deletePersonalChatMessage(
  userId: string,
  messageId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM personal_chat_messages WHERE id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function createPersonalExpense(params: {
  userId: string;
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO personal_expense_entries
       (user_id, amount, category, note, entry_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING id`,
    [params.userId, params.amount, params.category, params.note, params.entryDate],
  );
  return rows[0];
}

export async function createPersonalIncome(params: {
  userId: string;
  amount: string;
  category: string;
  note: string | null;
  entryDate: string;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO personal_income_entries
       (user_id, amount, category, note, entry_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING id`,
    [params.userId, params.amount, params.category, params.note, params.entryDate],
  );
  return rows[0];
}

export async function deletePersonalExpense(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM personal_expense_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deletePersonalIncome(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM personal_income_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function updatePersonalExpenseCategory(
  userId: string,
  id: string,
  category: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE personal_expense_entries SET category = $3
     WHERE id = $1 AND user_id = $2`,
    [id, userId, category],
  );
  return (rowCount ?? 0) > 0;
}

export async function updatePersonalIncomeCategory(
  userId: string,
  id: string,
  category: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE personal_income_entries SET category = $3
     WHERE id = $1 AND user_id = $2`,
    [id, userId, category],
  );
  return (rowCount ?? 0) > 0;
}
