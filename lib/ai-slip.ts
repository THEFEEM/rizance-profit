import "server-only";

import OpenAI from "openai";
import { fixThaiYear, THAI_BE_DATE_PROMPT } from "@/lib/date";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@/lib/expense-categories";

export const SLIP_SCAN_MODEL = "gpt-4.1-mini";

export type SlipScanResult = {
  amount: number | null;
  entryDate: string | null;
  paymentMethod: "cash" | "transfer" | null;
  category: string | null;
  merchantName: string | null;
  confidence: "low" | "medium" | "high";
};

function emptySlipScanResult(): SlipScanResult {
  return {
    amount: null,
    entryDate: null,
    paymentMethod: null,
    category: null,
    merchantName: null,
    confidence: "low",
  };
}

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildExtractSlipTool(
  categoryList: string,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "extract_slip",
      description: "Extract structured payment slip or receipt fields",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: ["number", "null"],
            description: "จำนวนเงินเป็นตัวเลขล้วน",
          },
          entry_date: {
            type: ["string", "null"],
            description: "วันที่รูปแบบ YYYY-MM-DD (ค.ศ.)",
          },
          payment_method: {
            type: ["string", "null"],
            enum: ["cash", "transfer", null],
          },
          category: {
            type: ["string", "null"],
            description: `เลือก key จากรายการนี้เท่านั้น: ${categoryList}`,
          },
          merchant_name: {
            type: ["string", "null"],
            description: "ชื่อร้าน ผู้รับเงิน หรือคู่รายการที่เห็นในภาพ",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
        },
        required: ["amount", "confidence"],
        additionalProperties: false,
      },
    },
  };
}

function parseToolArgs(argumentsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function scanSlip(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png",
  kind: "income" | "expense",
  slipType: "transfer" | "receipt",
  caption?: string,
): Promise<SlipScanResult> {
  const client = getClient();
  if (!client) return emptySlipScanResult();

  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const categoryList = categories.map((c) => `${c.key} (${c.label})`).join(", ");
  const validKeys = new Set<string>(categories.map((c) => c.key));
  const anchor =
    slipType === "transfer"
      ? "นี่คือสลิปโอนเงินของธนาคารไทย"
      : "นี่คือใบเสร็จหรือใบกำกับภาษีจากร้านค้าไทย";

  const captionHint =
    caption && caption.trim() !== ""
      ? `\nผู้ใช้ระบุว่า: "${caption.trim()}" ให้ใช้ข้อมูลนี้ช่วยเดาหมวดหมู่\n` +
        "ถ้าผู้ใช้พูดว่า 'วัตถุดิบ' หมายถึง materials เสมอ"
      : "";

  try {
    const completion = await client.chat.completions.create({
      model: SLIP_SCAN_MODEL,
      tools: [buildExtractSlipTool(categoryList)],
      tool_choice: { type: "function", function: { name: "extract_slip" } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `${anchor}\n` +
                "ดึงข้อมูลตามที่เห็นจริงเท่านั้น ถ้าอ่านไม่ออกให้ใส่ null และห้ามเดา\n" +
                `kind ปัจจุบันคือ ${kind}\n` +
                `หมวดหมู่เลือก key จากรายการนี้เท่านั้น: ${categoryList}\n` +
                "ให้ confidence ตามความชัดและความแน่ใจของข้อมูลในภาพ\n" +
                THAI_BE_DATE_PROMPT +
                captionHint,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    });

    const toolCalls = completion.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return emptySlipScanResult();
    }

    const call = toolCalls[0];
    if (call.type !== "function") {
      return emptySlipScanResult();
    }

    const out = parseToolArgs(call.function.arguments);

    const category =
      typeof out.category === "string" && validKeys.has(out.category)
        ? out.category
        : null;
    const amount =
      typeof out.amount === "number" && Number.isFinite(out.amount)
        ? out.amount
        : null;
    const paymentMethod =
      out.payment_method === "cash" || out.payment_method === "transfer"
        ? out.payment_method
        : null;
    const confidence =
      out.confidence === "low" ||
      out.confidence === "medium" ||
      out.confidence === "high"
        ? out.confidence
        : "low";

    return {
      amount,
      entryDate: isValidDateString(out.entry_date)
        ? fixThaiYear(out.entry_date)
        : null,
      paymentMethod,
      category,
      merchantName: typeof out.merchant_name === "string" ? out.merchant_name : null,
      confidence,
    };
  } catch {
    return emptySlipScanResult();
  }
}

export type ReceiptLineScan = {
  id: string;
  note: string;
  amount: number;
  category: string | null;
  confidence: "low" | "medium" | "high";
};

export type ReceiptScanResult = {
  merchantName: string | null;
  entryDate: string | null;
  paymentMethod: "cash" | "transfer" | null;
  totalAmount: number | null;
  items: ReceiptLineScan[];
  confidence: "low" | "medium" | "high";
};

const EXTRACT_RECEIPT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_receipt_items",
    description:
      "แยกรายการสินค้าทุกบรรทัดจากใบเสร็จ พร้อมราคาและหมวดหมู่แต่ละรายการ",
    parameters: {
      type: "object",
      properties: {
        merchantName: {
          type: ["string", "null"],
          description: "ชื่อร้านค้า",
        },
        entryDate: {
          type: ["string", "null"],
          description: "วันที่บนใบเสร็จ format YYYY-MM-DD (แปลง พ.ศ. → ค.ศ.)",
        },
        paymentMethod: {
          type: ["string", "null"],
          enum: ["cash", "transfer", null],
          description: "ช่องทางชำระเงิน",
        },
        totalAmount: {
          type: ["number", "null"],
          description: "ยอดรวมทั้งหมดบนใบเสร็จ (ไม่ใช่ sum รายการ)",
        },
        items: {
          type: "array",
          description: "รายการสินค้าทุกบรรทัด (ไม่รวมแถวยอดรวม ภาษี ส่วนลด)",
          items: {
            type: "object",
            properties: {
              note: {
                type: "string",
                description: "ชื่อรายการ เช่น 'ลองบัดเลปอนท์ 2 ถุง×115'",
              },
              amount: {
                type: "number",
                description: "ราคารายการนี้ (บวกเสมอ ไม่รวมยอดรวม)",
              },
              category: {
                type: ["string", "null"],
                description:
                  "หมวดหมู่: materials=วัตถุดิบ, equipment=อุปกรณ์, " +
                  "beverages=เครื่องดื่ม, packaging=บรรจุภัณฑ์, " +
                  "utilities=สาธารณูปโภค, other=อื่นๆ",
              },
              confidence: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "ความมั่นใจในการอ่านรายการนี้",
              },
            },
            required: ["note", "amount", "confidence"],
            additionalProperties: false,
          },
        },
        confidence: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "ความมั่นใจรวมของใบเสร็จทั้งใบ",
        },
      },
      required: ["items", "confidence"],
      additionalProperties: false,
    },
  },
};

function emptyReceiptScanResult(): ReceiptScanResult {
  return {
    merchantName: null,
    entryDate: null,
    paymentMethod: null,
    totalAmount: null,
    items: [],
    confidence: "low",
  };
}

export async function scanReceipt(
  imageBase64: string,
  mediaType: string,
  kind: "income" | "expense",
  caption?: string,
): Promise<ReceiptScanResult> {
  const client = getClient();
  if (!client) return emptyReceiptScanResult();

  const systemPrompt = `คุณคือผู้ช่วยอ่านใบเสร็จสำหรับร้านค้าไทย
${THAI_BE_DATE_PROMPT}

กฎสำคัญ:
- แยกทุกบรรทัดที่มีชื่อสินค้า + ราคา
- ไม่รวมแถว: ยอดรวม, ภาษี, ส่วนลด, ค่าบริการ, ค่าส่ง
- amount ต้องเป็นตัวเลขบวกเสมอ
- ถ้าอ่านรายการไม่ชัด → confidence: "low" สำหรับรายการนั้น
- category ใช้ภาษาอังกฤษ: materials, equipment, beverages, packaging, utilities, other
- ถ้าไม่รู้ category → null`;

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "image_url",
      image_url: {
        url: `data:${mediaType};base64,${imageBase64}`,
        detail: "high",
      },
    },
  ];

  if (caption) {
    userContent.push({
      type: "text",
      text: `หมายเหตุเพิ่มเติม: ${caption}`,
    });
  }

  userContent.push({
    type: "text",
    text: `กรุณาแยกรายการจากใบเสร็จนี้ (ประเภท: ${kind === "expense" ? "รายจ่าย" : "รายรับ"})`,
  });

  try {
    const response = await client.chat.completions.create({
      model: SLIP_SCAN_MODEL,
      max_tokens: 2000,
      tools: [EXTRACT_RECEIPT_TOOL],
      tool_choice: { type: "function", function: { name: "extract_receipt_items" } },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (
      !toolCall ||
      toolCall.type !== "function" ||
      toolCall.function.name !== "extract_receipt_items"
    ) {
      throw new Error("scanReceipt: AI ไม่คืน tool call");
    }

    const raw = JSON.parse(toolCall.function.arguments) as {
      merchantName?: string | null;
      entryDate?: string | null;
      paymentMethod?: "cash" | "transfer" | null;
      totalAmount?: number | null;
      items: Array<{
        note: string;
        amount: number;
        category?: string | null;
        confidence: "low" | "medium" | "high";
      }>;
      confidence: "low" | "medium" | "high";
    };

    const validCategories = new Set([
      "materials",
      "equipment",
      "beverages",
      "packaging",
      "utilities",
      "other",
    ]);

    const items: ReceiptLineScan[] = (raw.items ?? [])
      .filter((item) => item.amount > 0)
      .map((item) => ({
        id: crypto.randomUUID(),
        note: item.note.trim(),
        amount: Math.round(item.amount * 100) / 100,
        category:
          item.category && validCategories.has(item.category) ? item.category : null,
        confidence: item.confidence,
      }));

    const paymentMethod =
      raw.paymentMethod === "cash" || raw.paymentMethod === "transfer"
        ? raw.paymentMethod
        : null;
    const confidence =
      raw.confidence === "low" ||
      raw.confidence === "medium" ||
      raw.confidence === "high"
        ? raw.confidence
        : "low";

    return {
      merchantName: raw.merchantName ?? null,
      entryDate: isValidDateString(raw.entryDate) ? fixThaiYear(raw.entryDate) : null,
      paymentMethod,
      totalAmount:
        typeof raw.totalAmount === "number" && Number.isFinite(raw.totalAmount)
          ? raw.totalAmount
          : null,
      items,
      confidence,
    };
  } catch {
    return emptyReceiptScanResult();
  }
}
