import Link from "next/link";
import {
  categoryBreakdown,
  dailySummary,
  listIncomeByDate,
  listExpenseByDate,
  listIncomeInPeriod,
  listExpenseInPeriod,
  periodSummary,
} from "@/lib/queries";
import {
  today,
  isValidDate,
  isValidPeriod,
  formatDateLabel,
  formatPeriodRangeLabel,
  currentMonth,
  type PeriodKey,
} from "@/lib/date";
import { boothNetForPeriod } from "@/lib/booth-queries";
import { sumDecimals } from "@/lib/money";
import { PeriodSelector } from "@/components/PeriodSelector";
import { DateNav } from "@/components/DateNav";
import { SummaryRows } from "@/components/SummaryRows";
import { CombinedProfitCard } from "@/components/CombinedProfitCard";
import {
  CategoryBreakdownPanel,
  type CategoryBreakdownEntry,
  type CategoryBreakdownRow,
} from "@/components/stats/CategoryBreakdownPanel";
import { EntryList, type EntryRow } from "@/components/EntryList";
import {
  EXPENSE_CATEGORY_OPTIONS,
  INCOME_CATEGORY_OPTIONS,
  type CategoryBreakdownItem,
  type User,
} from "@/types";

const PERIOD_SUMMARY_LABELS = {
  income: "สรุปรายรับ",
  expense: "สรุปรายจ่าย",
  profit: "กำไร",
};

const CLOSE_OUT_LABELS = {
  income: "รายรับ",
  expense: "รายจ่าย",
  profit: "กำไร",
};

/** Regular-shop Stats — Block 1 behavior, unchanged. */
export async function RegularStatsSummary({
  user,
  period,
  closeDate,
}: {
  user: User;
  period: PeriodKey;
  closeDate: string;
}) {
  const periodData = await periodSummary(user.id, period);
  const [closeOut, incomes, expenses, boothProfit, breakdown, periodIncomes, periodExpenses] =
    await Promise.all([
      dailySummary(user.id, closeDate),
      listIncomeByDate(user.id, closeDate),
      listExpenseByDate(user.id, closeDate),
      boothNetForPeriod(user.id, periodData.start, periodData.end),
      categoryBreakdown(user.id, periodData.start, periodData.end),
      listIncomeInPeriod(user.id, periodData.start, periodData.end),
      listExpenseInPeriod(user.id, periodData.start, periodData.end),
    ]);
  const combinedProfit = sumDecimals(periodData.profit, boothProfit);

  const entries: EntryRow[] = [
    ...incomes.map((i) => ({
      id: i.id,
      kind: "income" as const,
      amount: i.amount,
      note: i.note,
      category: i.category,
      createdAt: i.createdAt,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      kind: "expense" as const,
      amount: e.amount,
      note: e.note,
      category: e.category,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const entryTotal = periodData.incomeCount + periodData.expenseCount;

  const incomeRows = toBreakdownRows(breakdown.income, INCOME_CATEGORY_OPTIONS);
  const expenseRows = toBreakdownRows(breakdown.expense, EXPENSE_CATEGORY_OPTIONS);
  const incomeEntries = groupEntriesByCategory(periodIncomes);
  const expenseEntries = groupEntriesByCategory(periodExpenses);

  return (
    <>
      <div className="mt-3">
        <PeriodSelector period={period} date={closeDate} />
      </div>

      <div className="mt-4">
        <SummaryRows
          income={periodData.income}
          expense={periodData.expense}
          profit={periodData.profit}
          currency={user.currency}
          labels={PERIOD_SUMMARY_LABELS}
        />
        <p className="px-4 pt-2 text-center text-xs text-slate-400">
          {formatPeriodRangeLabel(periodData.start, periodData.end)}
          {entryTotal > 0 && ` · ${entryTotal.toLocaleString()} รายการ`}
        </p>
        {period === "month" && (
          <p className="px-4 pt-2 text-center">
            <Link
              href={`/summary/monthly?month=${currentMonth()}`}
              className="text-sm font-medium text-emerald-700"
            >
              ดูรายวันในเดือน →
            </Link>
          </p>
        )}
      </div>

      <CategoryBreakdownPanel
        incomeRows={incomeRows}
        expenseRows={expenseRows}
        incomeEntries={incomeEntries}
        expenseEntries={expenseEntries}
        currency={user.currency}
      />

      <div className="mt-8">
        <h2 className="px-4 text-base font-bold text-slate-900">ปิดร้าน</h2>
        <DateNav
          date={closeDate}
          label={formatDateLabel(closeDate)}
          period={period}
          maxDate={today()}
        />
        <SummaryRows
          income={closeOut.income}
          expense={closeOut.expense}
          profit={closeOut.profit}
          currency={user.currency}
          labels={CLOSE_OUT_LABELS}
        />
        <p className="px-4 pb-1 text-center text-xs text-slate-400">
          {closeOut.incomeCount + closeOut.expenseCount > 0
            ? `${closeOut.incomeCount} รายรับ · ${closeOut.expenseCount} รายจ่าย`
            : "ยังไม่มีรายการในวันนี้"}
        </p>
      </div>

      <CombinedProfitCard
        regularProfit={periodData.profit}
        boothProfit={boothProfit}
        combinedProfit={combinedProfit}
        currency={user.currency}
      />

      <div className="mt-6">
        <h2 className="px-4 pb-1 text-sm font-semibold text-slate-500">รายการ</h2>
        <div className="mx-2 overflow-hidden rounded-2xl bg-white shadow-sm">
          <EntryList
            entries={entries}
            currency={user.currency}
            emptyHint="ไม่มีรายการในวันนี้"
            readOnly
          />
        </div>
      </div>
    </>
  );
}

function toBreakdownRows(
  items: CategoryBreakdownItem[],
  options: readonly { value: string; label: string; icon: string }[],
): CategoryBreakdownRow[] {
  const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
  return items.map((item) => ({
    category: item.category,
    label: byValue[item.category]?.label ?? item.category,
    icon: byValue[item.category]?.icon ?? "•",
    amount: item.amount,
    count: item.count,
  }));
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

export function parseRegularStatsParams(params: { period?: string; date?: string }) {
  const period: PeriodKey =
    params.period && isValidPeriod(params.period) ? params.period : "today";
  const bangkokToday = today();
  let closeDate =
    params.date && isValidDate(params.date) ? params.date : bangkokToday;
  if (closeDate > bangkokToday) closeDate = bangkokToday;
  return { period, closeDate };
}
