import { NextRequest, NextResponse } from "next/server";
import { parseTextEntry } from "@/lib/ai-chat";
import {
  categoryLabelOf,
  insertChatMessage,
  type ChatCardData,
} from "@/lib/chat-queries";
import {
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from "@/lib/expense-categories";
import { today } from "@/lib/date";
import { createExpense, createIncome } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import type { PaymentMethod } from "@/types";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const trimmed = text.trim();

  await insertChatMessage(user.id, { role: "user", content: trimmed });

  const parsed = await parseTextEntry(trimmed, today());

  if (parsed.error) {
    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      content: "ตอนนี้ใช้งานไม่ได้ ลองใหม่อีกครั้งภายหลัง",
    });
    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  if (parsed.reply) {
    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      content: parsed.reply,
    });
    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  if (!parsed.kind || parsed.amount == null || parsed.amount <= 0) {
    const fallback = "ขอโทษค่ะ ไม่เข้าใจจำนวนเงิน ลองพิมพ์เช่น 'ซื้อกาแฟ 100'";
    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      content: fallback,
    });
    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  if (parsed.confidence === "low") {
    const lowConfidence =
      "ไม่แน่ใจว่าจะบันทึกอะไร ลองพิมพ์ให้ชัด เช่น 'ซื้อกาแฟ 100'";
    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      content: lowConfidence,
    });
    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  const paymentMethod: PaymentMethod = parsed.paymentMethod ?? "cash";
  const entryDate = parsed.entryDate ?? today();

  if (parsed.kind === "income") {
    const category = normalizeIncomeCategory(parsed.category, "other_income");
    const entry = await createIncome(user.id, {
      amount: parsed.amount,
      category,
      paymentMethod,
      note: parsed.note ?? undefined,
      entryDate,
    });

    const cardData: ChatCardData = {
      kind: "income",
      amount: parsed.amount.toFixed(2),
      category,
      categoryLabel: categoryLabelOf("income", category),
      paymentMethod,
      note: parsed.note,
      entryDate,
      confidence: parsed.confidence,
    };

    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      entryId: entry.id,
      entryKind: "income",
      cardData,
    });

    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  const category = normalizeExpenseCategory(parsed.category, "expense_misc");
  const entry = await createExpense(user.id, {
    amount: parsed.amount,
    category,
    paymentMethod,
    note: parsed.note ?? undefined,
    entryDate,
  });

  const cardData: ChatCardData = {
    kind: "expense",
    amount: parsed.amount.toFixed(2),
    category,
    categoryLabel: categoryLabelOf("expense", category),
    paymentMethod,
    note: parsed.note,
    entryDate,
    confidence: parsed.confidence,
  };

  const aiMsg = await insertChatMessage(user.id, {
    role: "assistant",
    entryId: entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [aiMsg] } });
}
