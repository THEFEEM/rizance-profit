import "server-only";

import OpenAI from "openai";
import { fixThaiYear, periodRange, THAI_BE_DATE_PROMPT, today } from "@/lib/date";
import { personalPeriodSummary } from "@/lib/personal-queries";
import {
  PERSONAL_EXPENSE_KEYS,
  PERSONAL_EXPENSE_LABELS,
  PERSONAL_INCOME_KEYS,
  PERSONAL_INCOME_LABELS,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";

export const CHAT_PARSE_MODEL = "gpt-4.1-mini";

export type ParsedPersonalEntry = {
  kind: "income" | "expense" | null;
  amount: number | null;
  category: string | null;
  note: string | null;
  entryDate: string | null;
  confidence: "low" | "medium" | "high";
  reply: string | null;
  error?: boolean;
};

export type PersonalRizqAction =
  | { type: "record"; entry: ParsedPersonalEntry }
  | { type: "query"; period: string }
  | { type: "reply"; reply: string }
  | { type: "error"; reply: string };

const incomeList = PERSONAL_INCOME_KEYS.map(
  (k) => `${k} (${PERSONAL_INCOME_LABELS[k]})`,
).join(", ");
const expenseList = PERSONAL_EXPENSE_KEYS.map(
  (k) => `${k} (${PERSONAL_EXPENSE_LABELS[k]})`,
).join(", ");

export function buildPersonalRizqSystemPrompt(todayDate: string): string {
  return (
    `คุณคือ Rizq ผู้ช่วยการเงินส่วนตัว สำหรับผู้ใช้รายบุคคล\n` +
    `วันนี้: ${todayDate}\n\n` +
    `หน้าที่:\n` +
    `- จดรายรับ-รายจ่ายส่วนตัว เช่น เงินเดือน ค่าอาหาร ค่าเช่า\n` +
    `- วิเคราะห์การใช้จ่ายและแนะนำการออม\n` +
    `- ตอบคำถามการเงินส่วนตัว\n\n` +
    `หมวดรายรับ: ${incomeList}\n` +
    `หมวดรายจ่าย: ${expenseList}\n\n` +
    `กฎสำคัญ:\n` +
    `- ไม่มี payment_method (เงินสด/โอน) — personal mode ไม่ใช้\n` +
    `- ห้ามใช้ savings_deposit / savings_withdrawal ใน Phase 1\n` +
    `- ตอบภาษาไทยเสมอ กระชับ ไม่เกิน 2 บรรทัด\n`
  );
}

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseToolArgs(argumentsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildTools(todayDate: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "record_personal_entry",
        description: "จดรายรับหรือรายจ่ายส่วนตัว",
        parameters: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["income", "expense"],
              description: "income=รายรับ, expense=รายจ่าย",
            },
            amount: {
              type: "number",
              description: "จำนวนเงินตัวเลขล้วน",
            },
            category: {
              type: "string",
              description:
                `ถ้า income เลือก key จาก: ${incomeList}\n` +
                `ถ้า expense เลือก key จาก: ${expenseList}\n` +
                "ห้ามใช้ savings_deposit หรือ savings_withdrawal",
            },
            note: {
              type: ["string", "null"],
              description: "รายละเอียดสั้นๆ",
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
          required: ["kind", "amount", "category", "confidence"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_personal_summary",
        description:
          "ดึงสรุปรายรับ-รายจ่ายส่วนตัวเมื่อผู้ใช้ถามเกี่ยวกับการใช้จ่าย เงินเหลือ หรืองบประมาณ",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["today", "month", "last_7", "last_30", "all"],
            },
          },
          required: ["period"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function parseRecordArgs(out: Record<string, unknown>): ParsedPersonalEntry {
  const kind =
    out.kind === "income" || out.kind === "expense" ? out.kind : null;
  const validKeys = new Set<string>(
    kind === "income"
      ? PERSONAL_INCOME_KEYS.filter((k) => k !== "savings_withdrawal")
      : kind === "expense"
        ? PERSONAL_EXPENSE_KEYS.filter((k) => k !== "savings_deposit")
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
    note: typeof out.note === "string" ? out.note : null,
    entryDate: isValidDateString(out.entry_date)
      ? fixThaiYear(out.entry_date)
      : isValidDateString(out.entryDate)
        ? fixThaiYear(out.entryDate)
        : null,
    confidence,
    reply: typeof out.reply === "string" ? out.reply : null,
    error: false,
  };
}

function buildPrompt(text: string, todayDate: string): string {
  return (
    `ผู้ใช้พิมพ์: "${text}"\n` +
    `วันนี้คือ ${todayDate}\n` +
    "เลือกการทำงานที่เหมาะสม:\n" +
    "- ถ้าเป็นการบันทึกรายรับ/รายจ่ายที่ชัดเจน → เรียก record_personal_entry\n" +
    "- ถ้าถามสรุปการใช้จ่าย เงินเหลือ งบประมาณ → เรียก get_personal_summary เท่านั้น\n" +
    "- ถ้าทักทาย คุยทั่วไป → ตอบเป็นข้อความภาษาไทยโดยไม่เรียก tool\n" +
    "สำหรับ record_personal_entry: ถ้าข้อมูลไม่พอ ใส่ reply ถามกลับ ห้ามเดา amount\n" +
    THAI_BE_DATE_PROMPT
  );
}

type PersonalSummaryPeriod = "today" | "month" | "last_7" | "last_30" | "all";

function normalizePeriod(period: string): PersonalSummaryPeriod {
  if (
    period === "today" ||
    period === "month" ||
    period === "last_7" ||
    period === "last_30" ||
    period === "all"
  ) {
    return period;
  }
  return "month";
}

function resolveDateRange(period: PersonalSummaryPeriod): { start: string; end: string } {
  if (period === "all") {
    return { start: "1970-01-01", end: today() };
  }
  if (period === "today") {
    const date = today();
    return { start: date, end: date };
  }
  if (period === "month") {
    return periodRange("month");
  }
  return periodRange(period);
}

const PERIOD_LABELS: Record<PersonalSummaryPeriod, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  last_7: "7 วันที่ผ่านมา",
  last_30: "30 วันที่ผ่านมา",
  all: "ทั้งหมด",
};

export async function formatPersonalSummaryAnswer(
  userId: string,
  period: string,
): Promise<string> {
  const resolved = normalizePeriod(period);
  const { start, end } = resolveDateRange(resolved);
  const summary = await personalPeriodSummary(userId, start, end);
  const label = PERIOD_LABELS[resolved];
  return (
    `📊 สรุปการเงินส่วนตัว — ${label}\n\n` +
    `รายรับ: ${summary.income} บาท\n` +
    `รายจ่าย: ${summary.expense} บาท\n` +
    `คงเหลือ: ${summary.balance} บาท`
  );
}

export async function parsePersonalUserMessage(
  text: string,
  todayDate: string,
): Promise<PersonalRizqAction> {
  const client = getClient();
  if (!client) {
    return { type: "error", reply: "Rizq ยังไม่พร้อม" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: CHAT_PARSE_MODEL,
      tools: buildTools(todayDate),
      tool_choice: "auto",
      messages: [
        { role: "system", content: buildPersonalRizqSystemPrompt(todayDate) },
        { role: "user", content: buildPrompt(text, todayDate) },
      ],
    });

    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      if (call.type === "function") {
        const out = parseToolArgs(call.function.arguments);

        if (call.function.name === "get_personal_summary") {
          const period = typeof out.period === "string" ? out.period : "month";
          return { type: "query", period };
        }

        if (call.function.name === "record_personal_entry") {
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
      reply: "ขอโทษค่ะ ไม่เข้าใจ ลองพิมพ์ใหม่ เช่น 'ค่าอาหาร 150'",
    };
  } catch {
    return { type: "error", reply: "ขอโทษค่ะ ระบบมีปัญหา ลองใหม่อีกครั้ง" };
  }
}

export type { PersonalExpenseKey, PersonalIncomeKey };
