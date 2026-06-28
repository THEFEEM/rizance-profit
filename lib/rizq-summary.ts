import "server-only";

import { periodRange, today } from "@/lib/date";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import { formatMoney } from "@/lib/format";
import {
  allTimeSummary,
  categoryBreakdown,
  dailySummary,
  monthToDateSummary,
  periodSummary,
} from "@/lib/queries";
import { computeShopOnHand, type ShopOnHand } from "@/lib/shop-on-hand";
import type { CategoryBreakdown, PeriodKey } from "@/types";

export type RizqSummaryPeriod =
  | "today"
  | "month"
  | "last_7"
  | "last_30"
  | "all";

export type RizqSummaryMetric = "summary" | "on_hand" | "category";

export type RizqSummaryData = {
  income: string;
  expense: string;
  profit: string;
};

export type RizqFinancialContext =
  | { metric: "summary"; data: RizqSummaryData }
  | { metric: "on_hand"; data: ShopOnHand }
  | { metric: "category"; data: CategoryBreakdown; summary: RizqSummaryData };

const PERIOD_LABELS: Record<RizqSummaryPeriod, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  last_7: "7 วันที่ผ่านมา",
  last_30: "30 วันที่ผ่านมา",
  all: "ทั้งหมด",
};

const MONEY_LABEL_WIDTH = 12;
const CATEGORY_LABEL_WIDTH = 10;
const DIVIDER = "──────────────";

function normalizePeriod(period: string): RizqSummaryPeriod {
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

function normalizeMetric(metric: string): RizqSummaryMetric {
  if (metric === "on_hand" || metric === "category") return metric;
  return "summary";
}

function resolveDateRange(period: RizqSummaryPeriod): { start: string; end: string } {
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
  return periodRange(period as PeriodKey);
}

async function fetchSummaryData(
  userId: string,
  period: RizqSummaryPeriod,
): Promise<RizqSummaryData> {
  if (period === "today") {
    const summary = await dailySummary(userId, today());
    return {
      income: summary.income,
      expense: summary.expense,
      profit: summary.profit,
    };
  }

  if (period === "month") {
    const summary = await monthToDateSummary(userId);
    return {
      income: summary.income,
      expense: summary.expense,
      profit: summary.profit,
    };
  }

  if (period === "all") {
    const summary = await allTimeSummary(userId);
    return {
      income: summary.income,
      expense: summary.expense,
      profit: summary.profit,
    };
  }

  const summary = await periodSummary(userId, period);
  return {
    income: summary.income,
    expense: summary.expense,
    profit: summary.profit,
  };
}

function fmtBaht(amount: string): string {
  return `฿${formatMoney(amount)}`;
}

function moneyLine(label: string, amount: string): string {
  return `${label.padEnd(MONEY_LABEL_WIDTH)}${fmtBaht(amount)}`;
}

function formatProfitLossBlock(data: RizqSummaryData): string {
  return [
    moneyLine("รายรับ", data.income),
    moneyLine("รายจ่าย", data.expense),
    DIVIDER,
    moneyLine("กำไร", data.profit),
  ].join("\n");
}

function formatSummaryAnswer(data: RizqSummaryData, period: RizqSummaryPeriod): string {
  const periodLabel = PERIOD_LABELS[period];
  return `📊 สรุปการเงิน — ${periodLabel}\n\n${formatProfitLossBlock(data)}`;
}

function formatOnHandAnswer(onHand: ShopOnHand): string {
  return [
    "💵 เงินคงเหลือ",
    "",
    moneyLine("เงินสด", onHand.cashOnHand),
    moneyLine("เงินโอน", onHand.transferOnHand),
    DIVIDER,
    moneyLine("รวม", onHand.totalOnHand),
  ].join("\n");
}

function categoryLine(label: string, amount: string, count: number): string {
  return `- ${label.padEnd(CATEGORY_LABEL_WIDTH)} ${fmtBaht(amount)} (${count} รายการ)`;
}

function formatCategoryAnswer(
  breakdown: CategoryBreakdown,
  period: RizqSummaryPeriod,
  summary: RizqSummaryData,
): string {
  const periodLabel = PERIOD_LABELS[period];
  const lines: string[] = [`📊 สรุปการเงิน — ${periodLabel}`, "", formatProfitLossBlock(summary)];

  if (breakdown.expense.length > 0) {
    lines.push("", "💸 รายจ่ายแยกหมวด");
    for (const item of breakdown.expense) {
      lines.push(categoryLine(expenseCategoryLabel(item.category), item.amount, item.count));
    }
  }

  if (breakdown.income.length > 0) {
    lines.push("", "💰 รายรับแยกหมวด");
    for (const item of breakdown.income) {
      lines.push(categoryLine(incomeCategoryLabel(item.category), item.amount, item.count));
    }
  }

  if (breakdown.expense.length === 0 && breakdown.income.length === 0) {
    lines.push("", "ยังไม่มีรายการแยกหมวดในช่วงนี้");
  }

  return lines.join("\n");
}

export async function getFinancialContext(
  userId: string,
  period: string,
  metric: string,
): Promise<RizqFinancialContext> {
  const resolvedPeriod = normalizePeriod(period);
  const resolvedMetric = normalizeMetric(metric);

  if (resolvedMetric === "on_hand") {
    const onHand = await computeShopOnHand(userId);
    return { metric: "on_hand", data: onHand };
  }

  if (resolvedMetric === "category") {
    const { start, end } = resolveDateRange(resolvedPeriod);
    const [breakdown, summary] = await Promise.all([
      categoryBreakdown(userId, start, end),
      fetchSummaryData(userId, resolvedPeriod),
    ]);
    return { metric: "category", data: breakdown, summary };
  }

  const data = await fetchSummaryData(userId, resolvedPeriod);
  return { metric: "summary", data };
}

export function formatFinancialAnswer(
  context: RizqFinancialContext,
  period: string,
): string {
  const resolvedPeriod = normalizePeriod(period);

  if (context.metric === "on_hand") {
    return formatOnHandAnswer(context.data);
  }

  if (context.metric === "category") {
    return formatCategoryAnswer(context.data, resolvedPeriod, context.summary);
  }

  return formatSummaryAnswer(context.data, resolvedPeriod);
}
