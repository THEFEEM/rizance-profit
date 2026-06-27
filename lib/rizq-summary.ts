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
  | { metric: "category"; data: CategoryBreakdown };

const PERIOD_LABELS: Record<RizqSummaryPeriod, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  last_7: "7 วันที่ผ่านมา",
  last_30: "30 วันที่ผ่านมา",
  all: "ทั้งหมด",
};

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

function formatSummaryAnswer(data: RizqSummaryData, period: RizqSummaryPeriod): string {
  const periodLabel = PERIOD_LABELS[period];
  const profit = parseFloat(data.profit);
  const profitEmoji = profit > 0 ? "📈" : profit < 0 ? "📉" : "➖";

  return (
    `${periodLabel}\n` +
    `💰 รายรับ: ${formatMoney(data.income)} บาท\n` +
    `💸 รายจ่าย: ${formatMoney(data.expense)} บาท\n` +
    `${profitEmoji} กำไรสุทธิ: ${formatMoney(data.profit)} บาท`
  );
}

function formatOnHandAnswer(onHand: ShopOnHand): string {
  return (
    `💵 เงินคงเหลือ\n` +
    `เงินสด: ${formatMoney(onHand.cashOnHand)} บาท\n` +
    `เงินโอน: ${formatMoney(onHand.transferOnHand)} บาท\n` +
    `รวม: ${formatMoney(onHand.totalOnHand)} บาท`
  );
}

function formatCategoryAnswer(
  breakdown: CategoryBreakdown,
  period: RizqSummaryPeriod,
): string {
  const periodLabel = PERIOD_LABELS[period];
  let text = `${periodLabel} — แยกตามหมวด\n\n`;

  if (breakdown.expense.length > 0) {
    text += "💸 รายจ่าย\n";
    for (const item of breakdown.expense) {
      text += `  • ${expenseCategoryLabel(item.category)}: ${formatMoney(item.amount)} บาท (${item.count} รายการ)\n`;
    }
  }

  if (breakdown.income.length > 0) {
    text += breakdown.expense.length > 0 ? "\n" : "";
    text += "💰 รายรับ\n";
    for (const item of breakdown.income) {
      text += `  • ${incomeCategoryLabel(item.category)}: ${formatMoney(item.amount)} บาท (${item.count} รายการ)\n`;
    }
  }

  if (breakdown.expense.length === 0 && breakdown.income.length === 0) {
    text += "ยังไม่มีรายการในช่วงนี้";
  }

  return text.trim();
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
    const breakdown = await categoryBreakdown(userId, start, end);
    return { metric: "category", data: breakdown };
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
    return formatCategoryAnswer(context.data, resolvedPeriod);
  }

  return formatSummaryAnswer(context.data, resolvedPeriod);
}
