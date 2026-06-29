import "server-only";

import { NextResponse } from "next/server";
import { scanSlip } from "@/lib/ai-slip";
import {
  boothCategoryLabelOf,
  insertBoothChatMessage,
  normalizeBoothExpenseCategory,
  normalizeBoothIncomeCategory,
} from "@/lib/booth-chat-queries";
import { createBoothExpense, createBoothIncome } from "@/lib/booth-queries";
import { today } from "@/lib/date";
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
  const { imageBase64, mediaType, kind, thumbnail, caption } = input;

  if (mediaType != null && !isSupportedMediaType(mediaType)) {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const scanKind = kind === "income" ? "income" : "expense";
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

  const entryDate = result.entryDate ?? today();
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
        content: "บันทึกไม่ได้ — ตรวจสอบว่างานบูธยังเปิดอยู่และวันที่ถูกต้อง",
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
      content: "บันทึกไม่ได้ — ตรวจสอบว่างานบูธยังเปิดอยู่และวันที่ถูกต้อง",
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
