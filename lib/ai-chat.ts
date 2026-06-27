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

export type RizqAction =
  | { type: "record"; entry: ParsedEntry }
  | { type: "query"; period: string; metric: string }
  | { type: "reply"; reply: string }
  | { type: "error"; reply: string };

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

function parseRecordArgs(out: Record<string, unknown>): ParsedEntry {
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
}

function buildModel(client: GoogleGenerativeAI, todayDate: string) {
  const incomeList = INCOME_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");
  const expenseList = EXPENSE_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");

  return client.getGenerativeModel({
    model: CHAT_PARSE_MODEL,
    tools: [
      {
        functionDeclarations: [
          {
            name: "record_entry",
            description:
              "บันทึกรายรับหรือรายจ่ายเมื่อผู้ใช้บอกว่าซื้อ จ่าย ขาย หรือได้เงิน พร้อมจำนวนเงิน",
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
                    "ถ้าจดไม่ได้/ข้อมูลไม่พอ ใส่คำถามกลับเป็นภาษาไทย ถ้าจดได้ชัดเจนใส่ null",
                },
              },
              required: ["kind", "amount", "confidence"],
            },
          },
          {
            name: "get_financial_summary",
            description:
              "ดึงข้อมูลสรุปการเงินเมื่อผู้ใช้ถามเกี่ยวกับกำไร รายรับ รายจ่าย เงินคงเหลือ หรือสถานะการเงิน",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                period: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["today", "month", "last_7", "last_30", "all"],
                  description:
                    "ช่วงเวลา: today=วันนี้, month=เดือนนี้, last_7=7วัน, last_30=30วัน, all=ทั้งหมด",
                },
                metric: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["summary", "on_hand", "category"],
                  description:
                    "summary=กำไร/รายรับ/รายจ่าย, on_hand=เงินคงเหลือ, category=แยกตามหมวด",
                },
              },
              required: ["period", "metric"],
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.AUTO,
      },
    },
  });
}

function buildPrompt(text: string, todayDate: string): string {
  return (
    `ผู้ใช้พิมพ์: "${text}"\n` +
    `วันนี้คือ ${todayDate}\n` +
    "เลือกการทำงานที่เหมาะสม:\n" +
    "- ถ้าเป็นการบันทึกรายรับ/รายจ่ายที่ชัดเจน (เช่น 'ซื้อกาแฟ 100') → เรียก record_entry\n" +
    "- ถ้าถามสรุปการเงิน กำไร รายรับ รายจ่าย เงินคงเหลือ หรือหมวดค่าใช้จ่าย → เรียก get_financial_summary\n" +
    "- ถ้าทักทาย คุยทั่วไป หรือไม่ใช่ทั้งสองอย่าง → ตอบเป็นข้อความภาษาไทยโดยไม่เรียก tool\n" +
    "สำหรับ record_entry: ถ้าข้อมูลไม่พอ (ไม่มีจำนวนเงิน) ใส่ reply ถามกลับ ห้ามเดา amount\n" +
    "สำหรับ record_entry: หมวดหมู่เลือก key จาก list เท่านั้น"
  );
}

export async function parseUserMessage(
  text: string,
  todayDate: string,
): Promise<RizqAction> {
  const client = getClient();
  if (!client) {
    return { type: "error", reply: "ระบบ AI ยังไม่พร้อม" };
  }

  try {
    const model = buildModel(client, todayDate);
    const result = await model.generateContent(buildPrompt(text, todayDate));
    const calls = result.response.functionCalls();

    if (calls && calls.length > 0) {
      const call = calls[0];
      if (call.name === "get_financial_summary") {
        const out = call.args as Record<string, unknown>;
        const period = typeof out.period === "string" ? out.period : "month";
        const metric = typeof out.metric === "string" ? out.metric : "summary";
        return { type: "query", period, metric };
      }

      if (call.name === "record_entry") {
        const entry = parseRecordArgs(call.args as Record<string, unknown>);
        if (entry.reply) {
          return { type: "reply", reply: entry.reply };
        }
        return { type: "record", entry };
      }
    }

    const replyText = result.response.text().trim();
    if (replyText) {
      return { type: "reply", reply: replyText };
    }

    return {
      type: "reply",
      reply: "ขอโทษค่ะ ไม่เข้าใจ ลองพิมพ์ใหม่ เช่น 'ซื้อกาแฟ 100'",
    };
  } catch {
    return { type: "error", reply: "ขอโทษค่ะ ระบบมีปัญหา ลองใหม่อีกครั้ง" };
  }
}

/** @deprecated Use parseUserMessage — kept for callers still on ParsedEntry shape. */
export async function parseTextEntry(
  text: string,
  todayDate: string,
): Promise<ParsedEntry> {
  const action = await parseUserMessage(text, todayDate);

  switch (action.type) {
    case "error":
      return emptyParsed(action.reply, true);
    case "reply":
      return emptyParsed(action.reply, false);
    case "record":
      return action.entry;
    case "query":
      return emptyParsed("", false);
  }
}
