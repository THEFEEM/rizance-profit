import "server-only";

import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
} from "@google/generative-ai";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@/lib/expense-categories";

export const SLIP_SCAN_MODEL = "gemini-2.5-flash";

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

function getClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function scanSlip(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png",
  kind: "income" | "expense",
  slipType: "transfer" | "receipt",
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

  try {
    const model = client.getGenerativeModel({
      model: SLIP_SCAN_MODEL,
      tools: [
        {
          functionDeclarations: [
            {
              name: "extract_slip",
              description: "Extract structured payment slip or receipt fields",
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  amount: {
                    type: SchemaType.NUMBER,
                    nullable: true,
                    description: "จำนวนเงินเป็นตัวเลขล้วน",
                  },
                  entry_date: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: "วันที่รูปแบบ YYYY-MM-DD",
                  },
                  payment_method: {
                    type: SchemaType.STRING,
                    format: "enum",
                    nullable: true,
                    enum: ["cash", "transfer"],
                  },
                  category: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: `เลือก key จากรายการนี้เท่านั้น: ${categoryList}`,
                  },
                  merchant_name: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: "ชื่อร้าน ผู้รับเงิน หรือคู่รายการที่เห็นในภาพ",
                  },
                  confidence: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["low", "medium", "high"],
                  },
                },
                required: ["amount", "confidence"],
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: ["extract_slip"],
        },
      },
    });

    const result = await model.generateContent([
      {
        text:
          `${anchor}\n` +
          "ดึงข้อมูลตามที่เห็นจริงเท่านั้น ถ้าอ่านไม่ออกให้ใส่ null และห้ามเดา\n" +
          `kind ปัจจุบันคือ ${kind}\n` +
          `หมวดหมู่เลือก key จากรายการนี้เท่านั้น: ${categoryList}\n` +
          "ให้ confidence ตามความชัดและความแน่ใจของข้อมูลในภาพ",
      },
      {
        inlineData: {
          mimeType: mediaType,
          data: imageBase64,
        },
      },
    ]);

    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) {
      return emptySlipScanResult();
    }

    const out = calls[0].args as Record<string, unknown>;

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
      entryDate: isValidDateString(out.entry_date) ? out.entry_date : null,
      paymentMethod,
      category,
      merchantName: typeof out.merchant_name === "string" ? out.merchant_name : null,
      confidence,
    };
  } catch {
    return emptySlipScanResult();
  }
}
