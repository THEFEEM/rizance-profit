import Link from "next/link";
import {
  categoryBreakdown,
  dailyProfitSeries,
  listExpenseInPeriod,
  listIncomeInPeriod,
  periodExpenseByFixedVariable,
  periodIncomeByCashTransfer,
  periodSummary,
} from "@/lib/queries";
import {
  currentMonth,
  formatDayShort,
  formatPeriodRangeLabel,
  formatWeekdayShortThai,
  PERIOD_LABELS,
  periodRange,
} from "@/lib/date";
import { formatMoney, toCents } from "@/lib/money";
import { shopSplitProfit } from "@/lib/shop-split";
import { StatsPeriodSelector, type StatsPeriodKey } from "@/components/stats/StatsPeriodSelector";
import { StatsSummaryCards } from "@/components/stats/StatsSummaryCards";
import { DailyProfitChart } from "@/components/stats/DailyProfitChart";
import { BreakdownSection, ProgressBarRow } from "@/components/stats/BreakdownSection";
import { SplitProfitCard } from "@/components/shared/SplitProfitCard";
import {
  CategoryProgressList,
  type CategoryProgressRow,
} from "@/components/stats/CategoryProgressList";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";
import {
  expenseCategoryIcon,
  expenseCategoryLabel,
  incomeCategoryIcon,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import type { CategoryBreakdownItem, User } from "@/types";

function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

function toCategoryProgressRows(
  items: CategoryBreakdownItem[],
  kind: "income" | "expense",
  totalAmount: string,
): CategoryProgressRow[] {
  const labelFn = kind === "income" ? incomeCategoryLabel : expenseCategoryLabel;
  const iconFn = kind === "income" ? incomeCategoryIcon : expenseCategoryIcon;
  return items
    .map((item) => ({
      category: item.category,
      label: labelFn(item.category),
      icon: iconFn(item.category),
      amount: item.amount,
      count: item.count,
      percentage: sharePercent(item.amount, totalAmount),
    }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount));
}

function groupEntriesByCategory(
  entries: { id: string; category: string; entryDate: string; amount: string; note: string | null }[],
): Record<string, CategoryBreakdownEntry[]> {
  const map: Record<string, CategoryBreakdownEntry[]> = {};
  for (const e of entries) {
    (map[e.category] ??= []).push({
      id: e.id,
      entryDate: e.entryDate,
      amount: e.amount,
      note: e.note,
    });
  }
  return map;
}

/** Regular-shop Stats — cards, chart, and progress breakdowns. */
export async function RegularStatsSummary({
  user,
  period,
}: {
  user: User;
  period: StatsPeriodKey;
}) {
  const { start, end } = periodRange(period);
  const [
    periodData,
    cashTransfer,
    fixedVariable,
    breakdown,
    periodIncomes,
    periodExpenses,
    dailySeries,
    shopSplit,
  ] = await Promise.all([
    periodSummary(user.id, period),
    periodIncomeByCashTransfer(user.id, start, end),
    periodExpenseByFixedVariable(user.id, start, end),
    categoryBreakdown(user.id, start, end),
    listIncomeInPeriod(user.id, start, end),
    listExpenseInPeriod(user.id, start, end),
    dailyProfitSeries(user.id, start, end),
    shopSplitProfit(user.id, start, end),
  ]);

  const totalIncome = periodData.income;
  const totalExpense = periodData.expense;
  const entryTotal = periodData.incomeCount + periodData.expenseCount;

  const incomeRows = toCategoryProgressRows(breakdown.income, "income", totalIncome);
  const expenseRows = toCategoryProgressRows(breakdown.expense, "expense", totalExpense);
  const incomeEntries = groupEntriesByCategory(periodIncomes);
  const expenseEntries = groupEntriesByCategory(periodExpenses);

  const useWeekdayLabels = period === "last_7";
  const chartData = dailySeries.map((p) => ({
    date: p.date,
    label: useWeekdayLabels ? formatWeekdayShortThai(p.date) : formatDayShort(p.date),
    profit: Number(p.profit),
    profitDisplay: p.profit,
  }));

  return (
    <>
      <StatsPeriodSelector period={period} />

      <div className="mt-4">
        <StatsSummaryCards
          income={totalIncome}
          expense={totalExpense}
          profit={periodData.profit}
          currency={user.currency}
        />
        <p className="px-4 pt-2 text-center text-xs text-rz-hint">
          {formatPeriodRangeLabel(periodData.start, periodData.end)}
          {entryTotal > 0 && ` · ${entryTotal.toLocaleString()} รายการ`}
        </p>
      </div>

      <section className="mt-6 px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-text">กำไรรายวัน</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-3">
          <DailyProfitChart data={chartData} currency={user.currency} />
        </div>
        <p className="mt-2 text-center">
          <Link
            href={`/summary/monthly?month=${currentMonth()}`}
            className="text-sm font-medium text-rz-green"
          >
            ดูรายวันในเดือน →
          </Link>
        </p>
      </section>

      <div className="mt-6 space-y-6">
        <BreakdownSection title="รายรับ">
          <div className="divide-y divide-rz-border">
            <ProgressBarRow
              label="เงินสด"
              amount={formatMoney(cashTransfer.cashIncome, user.currency)}
              percentage={sharePercent(cashTransfer.cashIncome, totalIncome)}
              tone="green"
            />
            <ProgressBarRow
              label="เงินโอน"
              amount={formatMoney(cashTransfer.transferIncome, user.currency)}
              percentage={sharePercent(cashTransfer.transferIncome, totalIncome)}
              tone="green"
            />
          </div>
        </BreakdownSection>

        <BreakdownSection title="ค่าใช้จ่าย">
          <div className="divide-y divide-rz-border">
            <ProgressBarRow
              label="คงที่"
              amount={formatMoney(fixedVariable.fixedExpense, user.currency)}
              percentage={sharePercent(fixedVariable.fixedExpense, totalExpense)}
              tone="red"
            />
            <ProgressBarRow
              label="ผันแปร"
              amount={formatMoney(fixedVariable.variableExpense, user.currency)}
              percentage={sharePercent(fixedVariable.variableExpense, totalExpense)}
              tone="red"
            />
          </div>
        </BreakdownSection>

        {incomeRows.length > 0 && (
          <BreakdownSection title="รายรับตามหมวด">
            <CategoryProgressList
              rows={incomeRows}
              entriesByCategory={incomeEntries}
              currency={user.currency}
              tone="income"
            />
          </BreakdownSection>
        )}

        {expenseRows.length > 0 && (
          <BreakdownSection title="รายจ่ายตามหมวด">
            <CategoryProgressList
              rows={expenseRows}
              entriesByCategory={expenseEntries}
              currency={user.currency}
              tone="expense"
            />
          </BreakdownSection>
        )}
      </div>

      {shopSplit && (
        <SplitProfitCard
          split={shopSplit}
          currency={user.currency}
          accent="green"
          periodLabel={PERIOD_LABELS[period]}
        />
      )}
    </>
  );
}

export function parseRegularStatsParams(params: {
  period?: string;
  date?: string;
}): { period: StatsPeriodKey } {
  const period: StatsPeriodKey = params.period === "last_30" ? "last_30" : "last_7";
  return { period };
}
