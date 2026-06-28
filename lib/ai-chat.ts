import "server-only";

import OpenAI from "openai";
import { fixThaiYear, THAI_BE_DATE_PROMPT } from "@/lib/date";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@/lib/expense-categories";

export const CHAT_PARSE_MODEL = "gpt-4.1-mini";

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

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
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
    entryDate: isValidDateString(out.entry_date)
      ? fixThaiYear(out.entry_date)
      : null,
    confidence,
    reply: typeof out.reply === "string" ? out.reply : null,
    error: false,
  };
}

function buildTools(todayDate: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const incomeList = INCOME_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");
  const expenseList = EXPENSE_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");

  return [
    {
      type: "function",
      function: {
        name: "record_entry",
        description:
          "บันทึกรายรับหรือรายจ่ายเมื่อผู้ใช้บอกว่าซื้อ จ่าย ขาย หรือได้เงิน พร้อมจำนวนเงิน",
        parameters: {
          type: "object",
          properties: {
            kind: {
              type: ["string", "null"],
              enum: ["income", "expense", null],
              description: "income=รายรับ(ขาย/ได้เงิน), expense=รายจ่าย(ซื้อ/จ่าย)",
            },
            amount: {
              type: ["number", "null"],
              description: "จำนวนเงินตัวเลขล้วน",
            },
            category: {
              type: ["string", "null"],
              description:
                `ถ้า income เลือก key จาก: ${incomeList}\n` +
                `ถ้า expense เลือก key จาก: ${expenseList}\n` +
                "ถ้าผู้ใช้ระบุหมวดมาด้วย (เช่น 'ค่าไฟ สาธารณูปโภค', 'กาแฟ วัตถุดิบ') ให้ใช้ key ที่ตรงกับที่ผู้ใช้บอกก่อน",
            },
            payment_method: {
              type: ["string", "null"],
              enum: ["cash", "transfer", null],
            },
            note: {
              type: ["string", "null"],
              description: "รายละเอียดสั้นๆ เช่นชื่อสินค้า",
            },
            entry_date: {
              type: ["string", "null"],
              description: `วันที่ YYYY-MM-DD ค.ศ. (วันนี้=${todayDate})`,
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            reply: {
              type: ["string", "null"],
              description:
                "ถ้าจดไม่ได้/ข้อมูลไม่พอ ใส่คำถามกลับเป็นภาษาไทย ถ้าจดได้ชัดเจนใส่ null",
            },
          },
          required: ["kind", "amount", "confidence"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_financial_summary",
        description:
          "ดึงข้อมูลสรุปการเงินเมื่อผู้ใช้ถามเกี่ยวกับกำไร รายรับ รายจ่าย เงินคงเหลือ หรือสถานะการเงิน",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["today", "month", "last_7", "last_30", "all"],
              description:
                "ช่วงเวลา: today=วันนี้, month=เดือนนี้, last_7=7วัน, last_30=30วัน, all=ทั้งหมด",
            },
            metric: {
              type: "string",
              enum: ["summary", "on_hand", "category"],
              description:
                "summary=กำไร/รายรับ/รายจ่าย, on_hand=เงินคงเหลือ, category=แยกตามหมวด",
            },
          },
          required: ["period", "metric"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function buildPrompt(text: string, todayDate: string): string {
  return (
    `ผู้ใช้พิมพ์: "${text}"\n` +
    `วันนี้คือ ${todayDate}\n` +
    "เลือกการทำงานที่เหมาะสม:\n" +
    "- ถ้าเป็นการบันทึกรายรับ/รายจ่ายที่ชัดเจน (เช่น 'ซื้อกาแฟ 100') → เรียก record_entry\n" +
    "- ถ้าถามสรุปการเงิน กำไร รายรับ รายจ่าย เงินคงเหลือ หรือหมวดค่าใช้จ่าย → เรียก get_financial_summary เท่านั้น (ห้ามตอบสรุปเป็นข้อความเอง)\n" +
    "- ถ้าทักทาย คุยทั่วไป หรือไม่ใช่ทั้งสองอย่าง → ตอบเป็นข้อความภาษาไทยโดยไม่เรียก tool\n" +
    "สำหรับ record_entry: ถ้าข้อมูลไม่พอ (ไม่มีจำนวนเงิน) ใส่ reply ถามกลับ ห้ามเดา amount\n" +
    "สำหรับ record_entry: หมวดหมู่เลือก key จาก list เท่านั้น\n" +
    "สำหรับ record_entry: ถ้าผู้ใช้ระบุหมวดหมู่มาด้วย เช่น 'ค่าไฟ 850 สาธารณูปโภค' หรือ 'กาแฟ 100 วัตถุดิบ' ให้ใช้หมวดที่ผู้ใช้ระบุ (map เป็น key ที่ตรง)\n" +
    THAI_BE_DATE_PROMPT
  );
}

function parseToolArgs(argumentsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function parseUserMessage(
  text: string,
  todayDate: string,
): Promise<RizqAction> {
  const client = getClient();
  if (!client) {
    return { type: "error", reply: "Rizq ยังไม่พร้อม" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: CHAT_PARSE_MODEL,
      tools: buildTools(todayDate),
      tool_choice: "auto",
      messages: [{ role: "user", content: buildPrompt(text, todayDate) }],
    });

    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      if (call.type === "function") {
        const out = parseToolArgs(call.function.arguments);

        if (call.function.name === "get_financial_summary") {
          const period = typeof out.period === "string" ? out.period : "month";
          const metric = typeof out.metric === "string" ? out.metric : "summary";
          return { type: "query", period, metric };
        }

        if (call.function.name === "record_entry") {
          const entry = parseRecordArgs(out);
          if (entry.reply) {
            return { type: "reply", reply: entry.reply };
          }
          return { type: "record", entry };
        }
      }
    }

    const replyText = message?.content?.trim();
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
