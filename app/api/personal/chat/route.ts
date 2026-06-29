import { NextRequest, NextResponse } from "next/server";
import {
  parsePersonalUserMessage,
  formatPersonalSummaryAnswer,
  type ParsedPersonalEntry,
} from "@/lib/personal-ai-chat";
import { handlePersonalChatImage } from "@/lib/personal-chat-scan";
import { today } from "@/lib/date";
import {
  createPersonalExpense,
  createPersonalIncome,
  getPersonalChatMessages,
  insertPersonalChatMessage,
  normalizePersonalExpenseCategory,
  normalizePersonalIncomeCategory,
  personalCategoryLabelOf,
  type PersonalChatMessageRow,
} from "@/lib/personal-chat-queries";
import type { ChatCardData } from "@/lib/chat-types";
import { checkAndIncrement } from "@/lib/plan-check";
import {
  getActiveSubscriptionPlan,
  quotaExceededResponse,
} from "@/lib/subscription-user";
import { getCurrentUser } from "@/lib/session";

async function replyAssistant(
  userId: string,
  content: string,
): Promise<NextResponse> {
  const aiMsg = await insertPersonalChatMessage(userId, {
    role: "assistant",
    content,
  });
  return NextResponse.json({ data: { messages: [aiMsg] } });
}

async function recordEntry(
  userId: string,
  parsed: ParsedPersonalEntry,
): Promise<NextResponse> {
  if (!parsed.kind || parsed.amount == null || parsed.amount <= 0) {
    return replyAssistant(
      userId,
      "ขอโทษค่ะ ไม่เข้าใจจำนวนเงิน ลองพิมพ์เช่น 'ค่าอาหาร 150'",
    );
  }

  if (parsed.confidence === "low") {
    return replyAssistant(
      userId,
      "ไม่แน่ใจว่าจะบันทึกอะไร ลองพิมพ์ให้ชัด เช่น 'ค่าอาหาร 150'",
    );
  }

  const entryDate = parsed.entryDate ?? today();

  if (parsed.kind === "income") {
    const category = normalizePersonalIncomeCategory(parsed.category);
    const entry = await createPersonalIncome({
      userId,
      amount: parsed.amount.toFixed(2),
      category,
      note: parsed.note,
      entryDate,
    });

    const cardData: ChatCardData = {
      kind: "income",
      amount: parsed.amount.toFixed(2),
      category,
      categoryLabel: personalCategoryLabelOf("income", category),
      note: parsed.note,
      entryDate,
      confidence: parsed.confidence,
    };

    const aiMsg = await insertPersonalChatMessage(userId, {
      role: "assistant",
      entryId: entry.id,
      entryKind: "income",
      cardData,
    });

    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  const category = normalizePersonalExpenseCategory(parsed.category);
  const entry = await createPersonalExpense({
    userId,
    amount: parsed.amount.toFixed(2),
    category,
    note: parsed.note,
    entryDate,
  });

  const cardData: ChatCardData = {
    kind: "expense",
    amount: parsed.amount.toFixed(2),
    category,
    categoryLabel: personalCategoryLabelOf("expense", category),
    note: parsed.note,
    entryDate,
    confidence: parsed.confidence,
  };

  const aiMsg = await insertPersonalChatMessage(userId, {
    role: "assistant",
    entryId: entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [aiMsg] } });
}

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

  const {
    text,
    imageBase64,
    mediaType,
    kind,
    slipType,
    thumbnail,
    caption,
  } = body as {
    text?: unknown;
    imageBase64?: unknown;
    mediaType?: unknown;
    kind?: unknown;
    slipType?: unknown;
    thumbnail?: unknown;
    caption?: unknown;
  };

  if (typeof imageBase64 === "string" && imageBase64.trim() !== "") {
    const activePlan = await getActiveSubscriptionPlan(user.id);
    const planCheck = await checkAndIncrement(user.id, activePlan, "scan_slip");
    if (!planCheck.allowed) {
      return quotaExceededResponse(planCheck);
    }

    return handlePersonalChatImage(user.id, {
      imageBase64,
      mediaType,
      kind,
      slipType,
      thumbnail,
      caption,
    });
  }

  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const trimmed = text.trim();

  await insertPersonalChatMessage(user.id, { role: "user", content: trimmed });

  const activePlan = await getActiveSubscriptionPlan(user.id);
  const planCheck = await checkAndIncrement(user.id, activePlan, "rizq_chat");
  if (!planCheck.allowed) {
    return quotaExceededResponse(planCheck);
  }

  const action = await parsePersonalUserMessage(trimmed, today());

  switch (action.type) {
    case "error":
      return replyAssistant(user.id, "ตอนนี้ใช้งานไม่ได้ ลองใหม่อีกครั้งภายหลัง");

    case "reply":
      return replyAssistant(user.id, action.reply);

    case "record":
      return recordEntry(user.id, action.entry);

    case "query": {
      const answer = await formatPersonalSummaryAnswer(user.id, action.period);
      return replyAssistant(user.id, answer);
    }
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const messages = await getPersonalChatMessages(user.id);
  return NextResponse.json({ data: { messages } satisfies { messages: PersonalChatMessageRow[] } });
}
