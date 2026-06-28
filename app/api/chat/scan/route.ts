import { NextRequest, NextResponse } from "next/server";
import { scanReceipt, scanSlip } from "@/lib/ai-slip";
import {
  buildReceiptCardData,
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

const UNCLEAR_SLIP_MESSAGE =
  "อ่านสลิปไม่ชัด ลองถ่ายใหม่ให้ชัดขึ้น หรือพิมพ์รายการเองได้ค่ะ";

function isSupportedMediaType(value: unknown): value is "image/jpeg" | "image/png" {
  return value === "image/jpeg" || value === "image/png";
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

  const { imageBase64, mediaType, kind, slipType, thumbnail, caption } = body as {
    imageBase64?: unknown;
    mediaType?: unknown;
    kind?: unknown;
    slipType?: unknown;
    thumbnail?: unknown;
    caption?: unknown;
  };

  if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

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

  const userMsg = await insertChatMessage(user.id, {
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
      const cardData = buildReceiptCardData(receiptResult, today());
      const aiMsg = await insertChatMessage(user.id, {
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
    scanSlipType,
    scanCaption,
  );

  if (result.amount == null || result.confidence === "low") {
    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      content: UNCLEAR_SLIP_MESSAGE,
    });
    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const paymentMethod: PaymentMethod = result.paymentMethod ?? "transfer";
  const entryDate = result.entryDate ?? today();

  if (scanKind === "income") {
    const category = normalizeIncomeCategory(result.category, "other_income");
    const entry = await createIncome(user.id, {
      amount: result.amount,
      category,
      paymentMethod,
      note: result.merchantName ?? undefined,
      entryDate,
    });

    const cardData: ChatCardData = {
      kind: "income",
      amount: result.amount.toFixed(2),
      category,
      categoryLabel: categoryLabelOf("income", category),
      paymentMethod,
      note: result.merchantName,
      entryDate,
      confidence: result.confidence,
    };

    const aiMsg = await insertChatMessage(user.id, {
      role: "assistant",
      entryId: entry.id,
      entryKind: "income",
      cardData,
    });

    return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
  }

  const category = normalizeExpenseCategory(result.category, "expense_misc");
  const entry = await createExpense(user.id, {
    amount: result.amount,
    category,
    paymentMethod,
    note: result.merchantName ?? undefined,
    entryDate,
  });

  const cardData: ChatCardData = {
    kind: "expense",
    amount: result.amount.toFixed(2),
    category,
    categoryLabel: categoryLabelOf("expense", category),
    paymentMethod,
    note: result.merchantName,
    entryDate,
    confidence: result.confidence,
  };

  const aiMsg = await insertChatMessage(user.id, {
    role: "assistant",
    entryId: entry.id,
    entryKind: "expense",
    cardData,
  });

  return NextResponse.json({ data: { messages: [userMsg, aiMsg] } });
}
