import { savingsRateFromGoals } from "@/lib/advance-creditors";
import {
  personalCategoryBreakdown,
  personalDailyProfitSeries,
  personalPeriodSummary,
  listPersonalIncomesInPeriod,
  listPersonalExpensesInPeriod,
  listSavingsGoals,
} from "@/lib/personal-queries";
import {
  formatDayShort,
  formatPeriodRangeLabel,
  formatWeekdayShortThai,
  periodRange,
} from "@/lib/date";
import { toCents } from "@/lib/money";
import { StatsPeriodSelector, type StatsPeriodKey } from "@/components/stats/StatsPeriodSelector";
import { StatsSummaryCards } from "@/components/stats/StatsSummaryCards";
import { DailyProfitChart } from "@/components/stats/DailyProfitChart";
import { BreakdownSection } from "@/components/stats/BreakdownSection";
import {
  CategoryProgressList,
  type CategoryProgressRow,
} from "@/components/stats/CategoryProgressList";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";
import {
  personalExpenseLabel,
  personalIncomeLabel,
} from "@/lib/personal-categories";
import {
  renderPersonalExpenseIcon,
  renderPersonalIncomeIcon,
} from "@/lib/category-lucide-icons";
import type { PersonalCategoryBreakdownItem } from "@/types/personal";
import type { User } from "@/types";

function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

function toCategoryProgressRows(
  items: PersonalCategoryBreakdownItem[],
  kind: "income" | "expense",
  totalAmount: string,
): CategoryProgressRow[] {
  const labelFn = kind === "income" ? personalIncomeLabel : personalExpenseLabel;
  const iconFn = kind === "income" ? renderPersonalIncomeIcon : renderPersonalExpenseIcon;
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

/** Personal-mode Stats — cards, expense chart, and category breakdowns. */
export async function PersonalStatsSummary({
  user,
  period,
}: {
  user: User;
  period: StatsPeriodKey;
}) {
  const { start, end } = periodRange(period);
  const days = period === "last_30" ? 30 : 7;

  const [
    periodData,
    incomeBreakdown,
    expenseBreakdown,
    periodIncomes,
    periodExpenses,
    dailySeries,
    goals,
  ] = await Promise.all([
    personalPeriodSummary(user.id, start, end),
    personalCategoryBreakdown(user.id, start, end, "income"),
    personalCategoryBreakdown(user.id, start, end, "expense"),
    listPersonalIncomesInPeriod(user.id, start, end),
    listPersonalExpensesInPeriod(user.id, start, end),
    personalDailyProfitSeries(user.id, days),
    listSavingsGoals(user.id),
  ]);

  const savingsRatePct = savingsRateFromGoals(goals);

  const totalIncome = periodData.income;
  const totalExpense = periodData.expense;
  const entryTotal = periodData.incomeCount + periodData.expenseCount;

  const incomeRows = toCategoryProgressRows(incomeBreakdown, "income", totalIncome);
  const expenseRows = toCategoryProgressRows(expenseBreakdown, "expense", totalExpense);
  const incomeEntries = groupEntriesByCategory(periodIncomes);
  const expenseEntries = groupEntriesByCategory(periodExpenses);

  const useWeekdayLabels = period === "last_7";
  const chartData = dailySeries.map((p) => ({
    date: p.date,
    label: useWeekdayLabels ? formatWeekdayShortThai(p.date) : formatDayShort(p.date),
    expense: Number(p.expense),
    expenseDisplay: p.expense,
  }));

  return (
    <>
      <StatsPeriodSelector period={period} basePath="/personal/summary" accent="rose" />

      <div className="mt-4">
        <StatsSummaryCards
          income={totalIncome}
          expense={totalExpense}
          balance={periodData.balance}
          currency={user.currency}
          variant="personal"
          accent="rose"
          savingsRatePct={savingsRatePct}
        />
        <p className="px-4 pt-2 text-center text-xs text-rz-hint">
          {formatPeriodRangeLabel(start, end)}
          {entryTotal > 0 && ` · ${entryTotal.toLocaleString()} รายการ`}
        </p>
      </div>

      <section className="mt-6 px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-text">รายจ่ายรายวัน</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-3">
          <DailyProfitChart data={chartData} currency={user.currency} mode="expense" />
        </div>
      </section>

      <div className="mt-6 space-y-6">
        {incomeRows.length > 0 && (
          <BreakdownSection title="รายรับตามหมวด">
            <CategoryProgressList
              rows={incomeRows}
              entriesByCategory={incomeEntries}
              currency={user.currency}
              tone="income"
              accent="rose"
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
    </>
  );
}

export function parsePersonalStatsParams(params: {
  period?: string;
}): { period: StatsPeriodKey } {
  const period: StatsPeriodKey = params.period === "last_30" ? "last_30" : "last_7";
  return { period };
}
