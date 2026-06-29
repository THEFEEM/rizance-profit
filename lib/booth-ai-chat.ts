import "server-only";

import OpenAI from "openai";
import { fixThaiYear, periodRange, THAI_BE_DATE_PROMPT, today } from "@/lib/date";
import { query } from "@/lib/db";
import { computeProfit } from "@/lib/money";
import {
  boothDaySummary,
  boothSummary,
  getBooth,
  splitProfit,
} from "@/lib/booth-queries";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@/lib/expense-categories";

export const CHAT_PARSE_MODEL = "gpt-4.1-mini";

export type ParsedBoothEntry = {
  kind: "income" | "expense" | null;
  amount: number | null;
  category: string | null;
  paymentMethod: "cash" | "transfer" | null;
  note: string | null;
  entryDate: string | null;
  confidence: "low" | "medium" | "high";
  reply: string | null;
};

export type BoothRizqAction =
  | { type: "record"; entry: ParsedBoothEntry }
  | { type: "query"; period: string; includeSplit: boolean }
  | { type: "reply"; reply: string }
  | { type: "error"; reply: string };

const incomeList = INCOME_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");
const expenseList = EXPENSE_CATEGORIES.map((c) => `${c.key} (${c.label})`).join(", ");

export function buildBoothRizqSystemPrompt(todayDate: string, boothName: string): string {
  return (
    `คุณคือ Rizq ผู้ช่วยการเงินสำหรับบูธ/อีเวนต์ "${boothName}"\n` +
    `วันนี้: ${todayDate}\n\n` +
    `หน้าที่:\n` +
    `- จดรายรับ-รายจ่ายของบูธ (booth_income_entries / booth_expense_entries)\n` +
    `- สรุปรายได้ ต้นทำ กำไร และแบ่งกำไรหุ้นส่วน\n` +
    `- ตอบคำถามเกี่ยวกับผลงานบูธ\n\n` +
    `หมวดรายรับ: ${incomeList}\n` +
    `หมวดรายจ่าย: ${expenseList}\n\n` +
    `กฎ:\n` +
    `- payment_method: cash หรือ transfer\n` +
    `- ตอบภาษาไทย กระชับ ไม่เกิน 3 บรรทัด\n`
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
        name: "record_booth_entry",
        description: "จดรายรับหรือรายจ่ายของบูธ",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["income", "expense"] },
            amount: { type: "number" },
            category: { type: "string" },
            payment_method: { type: "string", enum: ["cash", "transfer"] },
            note: { type: ["string", "null"] },
            entry_date: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            reply: { type: ["string", "null"] },
          },
          required: ["kind", "amount", "category", "confidence"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_booth_summary",
        description: "สรุปรายรับ-รายจ่าย-กำไรของบูธ และแบ่งกำไรหุ้นส่วน",
        parameters: {
          type: "object",
          properties: {
            period: { type: "string", enum: ["today", "event", "month"] },
            include_split: { type: "boolean" },
          },
          required: ["period"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function parseRecordArgs(out: Record<string, unknown>): ParsedBoothEntry {
  const kind = out.kind === "income" || out.kind === "expense" ? out.kind : null;
  const validIncome = new Set(INCOME_CATEGORIES.map((c) => c.key));
  const validExpense = new Set(EXPENSE_CATEGORIES.map((c) => c.key));
  const validKeys = kind === "income" ? validIncome : kind === "expense" ? validExpense : new Set();
  const category =
    typeof out.category === "string" && validKeys.has(out.category as never)
      ? out.category
      : null;
  const amount =
    typeof out.amount === "number" && Number.isFinite(out.amount) ? out.amount : null;
  const confidence =
    out.confidence === "low" || out.confidence === "medium" || out.confidence === "high"
      ? out.confidence
      : "low";
  const paymentMethod =
    out.payment_method === "cash" || out.payment_method === "transfer"
      ? out.payment_method
      : out.paymentMethod === "cash" || out.paymentMethod === "transfer"
        ? out.paymentMethod
        : "cash";

  return {
    kind,
    amount,
    category,
    paymentMethod,
    note: typeof out.note === "string" ? out.note : null,
    entryDate: isValidDateString(out.entry_date)
      ? fixThaiYear(out.entry_date)
      : isValidDateString(out.entryDate)
        ? fixThaiYear(out.entryDate)
        : null,
    confidence,
    reply: typeof out.reply === "string" ? out.reply : null,
  };
}

function buildPrompt(text: string, todayDate: string): string {
  return (
    `ผู้ใช้พิมพ์: "${text}"\n` +
    `วันนี้คือ ${todayDate}\n` +
    "- บันทึกรายการ → record_booth_entry\n" +
    "- ถามสรุป กำไร แบ่งกำไร → get_booth_summary (include_split=true เมื่อถามแบ่งกำไร)\n" +
    "- ทักทาย/คุยทั่วไป → ตอบเป็นข้อความ\n" +
    THAI_BE_DATE_PROMPT
  );
}

type BoothSummaryPeriod = "today" | "event" | "month";

function normalizePeriod(period: string): BoothSummaryPeriod {
  if (period === "today" || period === "event" || period === "month") return period;
  return "event";
}

export async function formatBoothSummaryAnswer(
  userId: string,
  boothId: string,
  period: string,
  includeSplit: boolean,
): Promise<string> {
  const booth = await getBooth(userId, boothId);
  if (!booth) return "ไม่พบข้อมูลบูธ";

  const resolved = normalizePeriod(period);
  let income: string;
  let expense: string;
  let profit: string;
  let label: string;

  if (resolved === "today") {
    const day = await boothDaySummary(userId, boothId, today());
    income = day?.income ?? "0.00";
    expense = day?.expense ?? "0.00";
    profit = day?.profit ?? "0.00";
    label = "วันนี้";
  } else if (resolved === "month") {
    const { start, end } = periodRange("month");
    const { rows } = await query<{ income: string; expense: string }>(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM booth_income_entries
                   WHERE booth_id = $1 AND user_id = $2
                     AND entry_date >= $3::date AND entry_date <= $4::date), 0)::text AS income,
         COALESCE((SELECT SUM(amount) FROM booth_expense_entries
                   WHERE booth_id = $1 AND user_id = $2
                     AND entry_date >= $3::date AND entry_date <= $4::date), 0)::text AS expense`,
      [boothId, userId, start, end],
    );
    income = rows[0]?.income ?? "0.00";
    expense = rows[0]?.expense ?? "0.00";
    profit = computeProfit(income, expense);
    label = "เดือนนี้";
  } else {
    const summary = await boothSummary(userId, boothId);
    income = summary?.totalIncome ?? "0.00";
    expense = summary?.totalExpense ?? "0.00";
    profit = summary?.profit ?? "0.00";
    label = `ทั้งงาน (${booth.name})`;
  }

  let answer =
    `📊 สรุปบูธ — ${label}\n\n` +
    `รายรับ: ${income} บาท\n` +
    `รายจ่าย: ${expense} บาท\n` +
    `กำไร: ${profit} บาท`;

  if (includeSplit) {
    const split = await splitProfit(userId, boothId);
    if (split) {
      answer +=
        `\n\n💰 แบ่งกำไรสุทธิ: ${split.netProfit} บาท` +
        `\nกองกลาง: ${split.poolShare.flooredShare} บาท`;
      if (split.memberShares.length > 0) {
        answer += `\nหุ้นส่วน:`;
        for (const m of split.memberShares.slice(0, 5)) {
          answer += `\n- ${m.name}: ${m.flooredShare} บาท`;
        }
      }
    }
  }

  return answer;
}

export async function parseBoothUserMessage(
  userId: string,
  boothId: string,
  text: string,
  todayDate: string,
): Promise<BoothRizqAction> {
  const booth = await getBooth(userId, boothId);
  if (!booth) {
    return { type: "error", reply: "ไม่พบข้อมูลบูธ" };
  }

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
        { role: "system", content: buildBoothRizqSystemPrompt(todayDate, booth.name) },
        { role: "user", content: buildPrompt(text, todayDate) },
      ],
    });

    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      if (call.type === "function") {
        const out = parseToolArgs(call.function.arguments);

        if (call.function.name === "get_booth_summary") {
          const period = typeof out.period === "string" ? out.period : "event";
          const includeSplit = out.include_split === true;
          return { type: "query", period, includeSplit };
        }

        if (call.function.name === "record_booth_entry") {
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
      reply: "ขอโทษค่ะ ไม่เข้าใจ ลองพิมพ์ใหม่ เช่น 'ขายได้ 5000'",
    };
  } catch {
    return { type: "error", reply: "ขอโทษค่ะ ระบบมีปัญหา ลองใหม่อีกครั้ง" };
  }
}
