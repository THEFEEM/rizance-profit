import { NextRequest, NextResponse } from "next/server";
import {
  formatBoothSummaryAnswer,
  parseBoothUserMessage,
  type ParsedBoothEntry,
} from "@/lib/booth-ai-chat";
import { handleBoothChatImage } from "@/lib/booth-chat-scan";
import {
  boothCategoryLabelOf,
  getBoothChatMessages,
  insertBoothChatMessage,
  normalizeBoothExpenseCategory,
  normalizeBoothIncomeCategory,
  type BoothChatMessageRow,
} from "@/lib/booth-chat-queries";
import { createBoothExpense, createBoothIncome, getBooth, resolveBoothEntryDate } from "@/lib/booth-queries";
import type { ChatCardData } from "@/lib/chat-types";
import { BOOTH_ENTRY_REASON_MESSAGES } from "@/lib/booth-errors";
import type { Booth } from "@/types/booth";
import { today } from "@/lib/date";
import { checkAndDeductTokens, resolveTokenScope } from "@/lib/token-budget";
import {
  getActiveSubscriptionPlan,
  tokenQuotaExceededResponse,
} from "@/lib/subscription-user";
import { getCurrentUser } from "@/lib/session";

type RouteContext = { params: Promise<{ boothId: string }> };

async function replyAssistant(
  userId: string,
  boothId: string,
  content: string,
): Promise<NextResponse> {
  const aiMsg = await insertBoothChatMessage(userId, boothId, {
    role: "assistant",
    content,
  });
  return NextResponse.json({ data: { messages: [aiMsg] } });
}

async function recordEntry(
  userId: string,
  booth: Booth,
  parsed: ParsedBoothEntry,
): Promise<NextResponse> {
  const boothId = booth.id;
  if (!parsed.kind || parsed.amount == null || parsed.amount <= 0) {
    return replyAssistant(
      userId,
      boothId,
      "ขอโทษค่ะ ไม่เข้าใจจำนวนเงิน ลองพิมพ์เช่น 'ขายได้ 5000'",
    );
  }

  if (parsed.confidence === "low") {
    return replyAssistant(
      userId,
      boothId,
      "ไม่แน่ใจว่าจะบันทึกอะไร ลองพิมพ์ให้ชัด เช่น 'ค่าวัตถุดิบ 800'",
    );
  }

  const paymentMethod = parsed.paymentMethod ?? "cash";
  const entryDate = resolveBoothEntryDate(booth, parsed.entryDate);

  if (parsed.kind === "income") {
    const category = normalizeBoothIncomeCategory(parsed.category);
    const created = await createBoothIncome(userId, boothId, {
      amount: parsed.amount,
      category,
      paymentMethod,
      note: parsed.note ?? undefined,
      entryDate,
    });

    if (!created.ok) {
      const message =
        BOOTH_ENTRY_REASON_MESSAGES[created.reason] ??
        "บันทึกไม่ได้ — ลองใหม่อีกครั้ง";
      return replyAssistant(userId, boothId, message);
    }

    const cardData: ChatCardData = {
      kind: "income",
      amount: parsed.amount.toFixed(2),
      category,
      categoryLabel: boothCategoryLabelOf("income", category),
      paymentMethod,
      note: parsed.note,
      entryDate,
      confidence: parsed.confidence,
    };

    const aiMsg = await insertBoothChatMessage(userId, boothId, {
      role: "assistant",
      entryId: created.entry.id,
      entryKind: "income",
      cardData,
    });

    return NextResponse.json({ data: { messages: [aiMsg] } });
  }

  const category = normalizeBoothExpenseCategory(parsed.category);
  const created = await createBoothExpense(userId, boothId, {
    amount: parsed.amount,
    category,
    note: parsed.note ?? undefined,
    entryDate,
  });

  if (!created.ok) {
    const message =
      BOOTH_ENTRY_REASON_MESSAGES[created.reason] ??
      "บันทึกไม่ได้ — ลองใหม่อีกครั้ง";
    return replyAssistant(userId, boothId, message);
  }

  const cardData: ChatCardData = {
    kind: "expense",
    amount: parsed.amount.toFixed(2),
    category,
    categoryLabel: boothCategoryLabelOf("expense", category),
    paymentMethod,
    note: parsed.note,
    entryDate,
    confidence: parsed.confidence,
  };

  const aiMsg = await insertBoothChatMessage(userId, boothId, {
    role: "assistant",
    entryId: created.entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [aiMsg] } });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { boothId } = await context.params;
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
    const scope = resolveTokenScope("booth", activePlan, boothId);
    const check = await checkAndDeductTokens(user.id, scope, "scan_slip");
    if (!check.allowed) {
      return tokenQuotaExceededResponse(check);
    }

    return handleBoothChatImage(user.id, boothId, {
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

  await insertBoothChatMessage(user.id, boothId, { role: "user", content: trimmed });

  const activePlan = await getActiveSubscriptionPlan(user.id);
  const scope = resolveTokenScope("booth", activePlan, boothId);
  const check = await checkAndDeductTokens(user.id, scope, "rizq_chat");
  if (!check.allowed) {
    return tokenQuotaExceededResponse(check);
  }

  const action = await parseBoothUserMessage(user.id, boothId, trimmed, today());

  switch (action.type) {
    case "error":
      return replyAssistant(user.id, boothId, "ตอนนี้ใช้งานไม่ได้ ลองใหม่อีกครั้งภายหลัง");

    case "reply":
      return replyAssistant(user.id, boothId, action.reply);

    case "record":
      return recordEntry(user.id, booth, action.entry);

    case "query": {
      const answer = await formatBoothSummaryAnswer(
        user.id,
        boothId,
        action.period,
        action.includeSplit,
      );
      return replyAssistant(user.id, boothId, answer);
    }
  }
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { boothId } = await context.params;
  const booth = await getBooth(user.id, boothId);
  if (!booth) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const messages = await getBoothChatMessages(user.id, boothId);
  return NextResponse.json({ data: { messages } satisfies { messages: BoothChatMessageRow[] } });
}
