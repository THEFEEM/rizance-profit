import "server-only";

import { periodRange, today } from "@/lib/date";
import {
  expenseCategoryLabel,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import {
  allTimeSummary,
  categoryBreakdown,
  dailySummary,
  monthToDateSummary,
  periodSummary,
} from "@/lib/queries";
import { computeShopOnHand } from "@/lib/shop-on-hand";
import type { CategoryBreakdown, PeriodKey } from "@/types";

export type RizqSummaryPeriod =
  | "today"
  | "month"
  | "last_7"
  | "last_30"
  | "all";

export type RizqSummaryMetric = "summary" | "on_hand" | "category";

const PERIOD_LABELS: Record<RizqSummaryPeriod, string> = {
  today: "วันนี้",
  month: "เดือนนี้",
  last_7: "7 วันล่าสุด",
  last_30: "30 วันล่าสุด",
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

function formatCategoryText(cat: CategoryBreakdown): string {
  const incomeLines = cat.income.map(
    (item) =>
      `- ${incomeCategoryLabel(item.category)}: ${item.amount} บาท (${item.count} รายการ)`,
  );
  const expenseLines = cat.expense.map(
    (item) =>
      `- ${expenseCategoryLabel(item.category)}: ${item.amount} บาท (${item.count} รายการ)`,
  );

  return [
    "รายรับตามหมวด:",
    incomeLines.length > 0 ? incomeLines.join("\n") : "- ไม่มีรายการ",
    "",
    "รายจ่ายตามหมวด:",
    expenseLines.length > 0 ? expenseLines.join("\n") : "- ไม่มีรายการ",
  ].join("\n");
}

export async function getFinancialContext(
  userId: string,
  period: string,
  metric: string,
): Promise<string> {
  const resolvedPeriod = normalizePeriod(period);
  const resolvedMetric = normalizeMetric(metric);

  if (resolvedMetric === "on_hand") {
    const onHand = await computeShopOnHand(userId);
    return `เงินคงเหลือ: เงินสด ${onHand.cashOnHand} บาท, เงินโอน ${onHand.transferOnHand} บาท, รวม ${onHand.totalOnHand} บาท`;
  }

  if (resolvedMetric === "category") {
    const { start, end } = resolveDateRange(resolvedPeriod);
    const cat = await categoryBreakdown(userId, start, end);
    return formatCategoryText(cat);
  }

  if (resolvedPeriod === "today") {
    const summary = await dailySummary(userId, today());
    return `รายรับ ${summary.income} บาท, รายจ่าย ${summary.expense} บาท, กำไร ${summary.profit} บาท`;
  }

  if (resolvedPeriod === "month") {
    const summary = await monthToDateSummary(userId);
    return `รายรับ ${summary.income} บาท, รายจ่าย ${summary.expense} บาท, กำไร ${summary.profit} บาท`;
  }

  if (resolvedPeriod === "all") {
    const summary = await allTimeSummary(userId);
    return `รายรับ ${summary.income} บาท, รายจ่าย ${summary.expense} บาท, กำไร ${summary.profit} บาท`;
  }

  const summary = await periodSummary(userId, resolvedPeriod);
  return `รายรับ ${summary.income} บาท, รายจ่าย ${summary.expense} บาท, กำไร ${summary.profit} บาท`;
}

export function formatFinancialAnswer(
  context: string,
  period: string,
  metric: string,
): string {
  const resolvedPeriod = normalizePeriod(period);
  const resolvedMetric = normalizeMetric(metric);
  const label = PERIOD_LABELS[resolvedPeriod];

  if (resolvedMetric === "on_hand") {
    return context;
  }

  if (resolvedMetric === "category") {
    return `${label}:\n${context}`;
  }

  return `${label} ${context}`;
}
