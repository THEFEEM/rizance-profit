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
