import "server-only";

import { NextResponse } from "next/server";
import { scanReceipt, scanSlip } from "@/lib/ai-slip";
import { buildReceiptCardData } from "@/lib/chat-queries";
import {
  boothCategoryLabelOf,
  insertBoothChatMessage,
  normalizeBoothExpenseCategory,
  normalizeBoothIncomeCategory,
} from "@/lib/booth-chat-queries";
import { createBoothExpense, createBoothIncome, getBooth, resolveBoothEntryDate } from "@/lib/booth-queries";
import { BOOTH_ENTRY_REASON_MESSAGES } from "@/lib/booth-errors";
import type { ChatCardData } from "@/lib/chat-types";

const UNCLEAR_SLIP_MESSAGE =
  "อ่านสลิปไม่ชัด ลองถ่ายใหม่ให้ชัดขึ้น หรือพิมพ์รายการเองได้ค่ะ";

function isSupportedMediaType(value: unknown): value is "image/jpeg" | "image/png" {
  return value === "image/jpeg" || value === "image/png";
}

export type BoothChatScanInput = {
  imageBase64: string;
  mediaType?: unknown;
  kind?: unknown;
  slipType?: unknown;
  thumbnail?: unknown;
  caption?: unknown;
};

export async function handleBoothChatImage(
  userId: string,
  boothId: string,
  input: BoothChatScanInput,
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

  const userMsg = await insertBoothChatMessage(userId, boothId, {
    role: "user",
    content: userContent,
    imageThumb,
  });

  const booth = await getBooth(userId, boothId);
  if (!booth) {
    const aiMsg = await insertBoothChatMessage(userId, boothId, {
      role: "assistant",
      content: BOOTH_ENTRY_REASON_MESSAGES.booth_not_found,
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  if (scanSlipType === "receipt" && scanKind === "expense") {
    const receiptResult = await scanReceipt(
      imageBase64,
      resolvedMediaType,
      scanKind,
      scanCaption,
    );

    if (receiptResult.items.length >= 2) {
      const entryDate = resolveBoothEntryDate(booth, receiptResult.entryDate ?? undefined);
      const cardData = buildReceiptCardData(receiptResult, entryDate);
      const aiMsg = await insertBoothChatMessage(userId, boothId, {
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
    const aiMsg = await insertBoothChatMessage(userId, boothId, {
      role: "assistant",
      content: UNCLEAR_SLIP_MESSAGE,
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const entryDate = resolveBoothEntryDate(booth, result.entryDate ?? undefined);
  const paymentMethod = result.paymentMethod ?? "cash";

  if (scanKind === "income") {
    const category = normalizeBoothIncomeCategory(result.category);
    const created = await createBoothIncome(userId, boothId, {
      amount: result.amount,
      category,
      paymentMethod,
      note: result.merchantName ?? undefined,
      entryDate,
    });

    if (!created.ok) {
      const aiMsg = await insertBoothChatMessage(userId, boothId, {
        role: "assistant",
        content: BOOTH_ENTRY_REASON_MESSAGES[created.reason] ?? "บันทึกไม่ได้ — ลองใหม่อีกครั้ง",
      });
      return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
    }

    const cardData: ChatCardData = {
      kind: "income",
      amount: result.amount.toFixed(2),
      category,
      categoryLabel: boothCategoryLabelOf("income", category),
      paymentMethod,
      note: result.merchantName,
      entryDate,
      confidence: result.confidence,
    };

    const aiMsg = await insertBoothChatMessage(userId, boothId, {
      role: "assistant",
      entryId: created.entry.id,
      entryKind: "income",
      cardData,
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const category = normalizeBoothExpenseCategory(result.category);
  const created = await createBoothExpense(userId, boothId, {
    amount: result.amount,
    category,
    note: result.merchantName ?? undefined,
    entryDate,
  });

  if (!created.ok) {
    const aiMsg = await insertBoothChatMessage(userId, boothId, {
      role: "assistant",
      content: BOOTH_ENTRY_REASON_MESSAGES[created.reason] ?? "บันทึกไม่ได้ — ลองใหม่อีกครั้ง",
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const cardData: ChatCardData = {
    kind: "expense",
    amount: result.amount.toFixed(2),
    category,
    categoryLabel: boothCategoryLabelOf("expense", category),
    paymentMethod,
    note: result.merchantName,
    entryDate,
    confidence: result.confidence,
  };

  const aiMsg = await insertBoothChatMessage(userId, boothId, {
    role: "assistant",
    entryId: created.entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
}
