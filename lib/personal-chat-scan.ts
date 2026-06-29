import "server-only";

import { NextResponse } from "next/server";
import { scanReceipt, scanSlip } from "@/lib/ai-slip";
import { today } from "@/lib/date";
import {
  buildPersonalReceiptCardData,
  createPersonalExpense,
  createPersonalIncome,
  insertPersonalChatMessage,
  mapScanCategoryToPersonal,
  normalizePersonalExpenseCategory,
  normalizePersonalIncomeCategory,
  personalCategoryLabelOf,
} from "@/lib/personal-chat-queries";
import type { ChatCardData } from "@/lib/chat-types";

const UNCLEAR_SLIP_MESSAGE =
  "อ่านสลิปไม่ชัด ลองถ่ายใหม่ให้ชัดขึ้น หรือพิมพ์รายการเองได้ค่ะ";

function isSupportedMediaType(value: unknown): value is "image/jpeg" | "image/png" {
  return value === "image/jpeg" || value === "image/png";
}

export type PersonalChatScanInput = {
  imageBase64: string;
  mediaType?: unknown;
  kind?: unknown;
  slipType?: unknown;
  thumbnail?: unknown;
  caption?: unknown;
};

export async function handlePersonalChatImage(
  userId: string,
  input: PersonalChatScanInput,
): Promise<NextResponse> {
  const { imageBase64, mediaType, kind, slipType, thumbnail, caption } = input;

  if (mediaType != null && !isSupportedMediaType(mediaType)) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const scanKind = kind === "income" ? "income" : "expense";
  const scanSlipType = slipType === "transfer" ? "transfer" : "receipt";
  const resolvedMediaType = isSupportedMediaType(mediaType) ? mediaType : "image/jpeg";

  const userContent =
    typeof caption === "string" && caption.trim() !== "" ? caption.trim() : "📷 สลิป";
  const scanCaption =
    typeof caption === "string" && caption.trim() !== "" ? caption.trim() : undefined;
  const imageThumb =
    typeof thumbnail === "string" && thumbnail.trim() !== "" ? thumbnail.trim() : null;

  const userMsg = await insertPersonalChatMessage(userId, {
    role: "user",
    content: userContent,
    imageThumb,
  });

  if (scanSlipType === "receipt" && scanKind === "expense") {
    const receiptResult = await scanReceipt(
      imageBase64,
      resolvedMediaType,
      scanKind,
      scanCaption,
    );

    if (receiptResult.items.length >= 2) {
      const cardData = buildPersonalReceiptCardData(receiptResult, today());
      const aiMsg = await insertPersonalChatMessage(userId, {
        role: "assistant",
        entryId: null,
        entryKind: "expense",
        cardData,
      });
      return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
    }
  }

  const result = await scanSlip(
    imageBase64,
    resolvedMediaType,
    scanKind,
    "transfer",
    scanCaption,
  );

  if (result.amount == null || result.confidence === "low") {
    const aiMsg = await insertPersonalChatMessage(userId, {
      role: "assistant",
      content: UNCLEAR_SLIP_MESSAGE,
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const entryDate = result.entryDate ?? today();
  const mappedCategory = mapScanCategoryToPersonal(scanKind, result.category);

  if (scanKind === "income") {
    const category = normalizePersonalIncomeCategory(mappedCategory);
    const entry = await createPersonalIncome({
      userId,
      amount: result.amount.toFixed(2),
      category,
      note: result.merchantName,
      entryDate,
    });

    const cardData: ChatCardData = {
      kind: "income",
      amount: result.amount.toFixed(2),
      category,
      categoryLabel: personalCategoryLabelOf("income", category),
      note: result.merchantName,
      entryDate,
      confidence: result.confidence,
    };

    const aiMsg = await insertPersonalChatMessage(userId, {
      role: "assistant",
      entryId: entry.id,
      entryKind: "income",
      cardData,
    });

    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const category = normalizePersonalExpenseCategory(mappedCategory);
  const entry = await createPersonalExpense({
    userId,
    amount: result.amount.toFixed(2),
    category,
    note: result.merchantName,
    entryDate,
  });

  const cardData: ChatCardData = {
    kind: "expense",
    amount: result.amount.toFixed(2),
    category,
    categoryLabel: personalCategoryLabelOf("expense", category),
    note: result.merchantName,
    entryDate,
    confidence: result.confidence,
  };

  const aiMsg = await insertPersonalChatMessage(userId, {
    role: "assistant",
    entryId: entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
}
