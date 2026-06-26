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

export const CHAT_PARSE_MODEL = "gemini-2.5-flash";

export type ParsedEntry = {
  kind: "income" | "expense" | null;
  amount: number | null;
  category: string | null;
  paymentMethod: "cash" | "transfer" | null;
  note: string | null;
  entryDate: string | null;
  confidence: "low" | "medium" | "high";
  reply: string | null;
  error?: boolean;
};

function emptyParsed(reply: string, error = false): ParsedEntry {
  return {
    kind: null,
    amount: null,
    category: null,
    paymentMethod: null,
    note: null,
    entryDate: null,
    confidence: "low",
    reply,
    error,
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

export async function parseTextEntry(
  text: string,
  todayDate: string,
): Promise<ParsedEntry> {
  const client = getClient();
  if (!client) return emptyParsed("ระบบ AI ยังไม่พร้อม", true);

  const incomeList = INCOME_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");
  const expenseList = EXPENSE_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");

  try {
    const model = client.getGenerativeModel({
      model: CHAT_PARSE_MODEL,
      tools: [
        {
          functionDeclarations: [
            {
              name: "record_entry",
              description: "บันทึกรายรับหรือรายจ่ายจากข้อความผู้ใช้",
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  kind: {
                    type: SchemaType.STRING,
                    format: "enum",
                    nullable: true,
                    enum: ["income", "expense"],
                    description: "income=รายรับ(ขาย/ได้เงิน), expense=รายจ่าย(ซื้อ/จ่าย)",
                  },
                  amount: {
                    type: SchemaType.NUMBER,
                    nullable: true,
                    description: "จำนวนเงินตัวเลขล้วน",
                  },
                  category: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: `ถ้า income เลือก key จาก: ${incomeList}\nถ้า expense เลือก key จาก: ${expenseList}`,
                  },
                  payment_method: {
                    type: SchemaType.STRING,
                    format: "enum",
                    nullable: true,
                    enum: ["cash", "transfer"],
                  },
                  note: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: "รายละเอียดสั้นๆ เช่นชื่อสินค้า",
                  },
                  entry_date: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description: `วันที่ YYYY-MM-DD (วันนี้=${todayDate})`,
                  },
                  confidence: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["low", "medium", "high"],
                  },
                  reply: {
                    type: SchemaType.STRING,
                    nullable: true,
                    description:
                      "ถ้าจดไม่ได้/ข้อมูลไม่พอ/ทักทาย/ไม่ใช่การบันทึกเงิน ใส่คำถามกลับเป็นภาษาไทย ถ้าจดได้ชัดเจนใส่ null",
                  },
                },
                required: ["kind", "amount", "confidence"],
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: ["record_entry"],
        },
      },
    });

    const result = await model.generateContent(
      `ผู้ใช้พิมพ์: "${text}"\n` +
        `วันนี้คือ ${todayDate}\n` +
        "ถ้าเป็นการบันทึกรายรับ/จ่าย ดึงข้อมูล ถ้าข้อมูลไม่พอ (เช่นไม่มีจำนวนเงิน) ใส่ reply ถามกลับ\n" +
        "ถ้าข้อความเป็นการทักทาย คำถาม หรือไม่ใช่การบันทึกเงินที่ชัดเจน ต้องใส่ reply เสมอ และห้ามเดา amount (ใส่ null)\n" +
        "หมวดหมู่เลือก key จาก list เท่านั้น",
    );

    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) {
      return emptyParsed(
        "ขอโทษค่ะ ไม่เข้าใจ ลองพิมพ์ใหม่ เช่น 'ซื้อกาแฟ 100'",
        false,
      );
    }

    const out = calls[0].args as Record<string, unknown>;

    const kind =
      out.kind === "income" || out.kind === "expense" ? out.kind : null;
    const validKeys = new Set<string>(
      kind === "income"
        ? INCOME_CATEGORIES.map((c) => c.key)
        : kind === "expense"
          ? EXPENSE_CATEGORIES.map((c) => c.key)
          : [],
    );
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
      kind,
      amount,
      category,
      paymentMethod,
      note: typeof out.note === "string" ? out.note : null,
      entryDate: isValidDateString(out.entry_date) ? out.entry_date : null,
      confidence,
      reply: typeof out.reply === "string" ? out.reply : null,
      error: false,
    };
  } catch {
    return emptyParsed("ขอโทษค่ะ ระบบมีปัญหา ลองใหม่อีกครั้ง", true);
  }
}
