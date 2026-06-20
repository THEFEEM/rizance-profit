import Link from "next/link";
import {
  boothDailyProfitSeries,
  boothSummary,
  listBoothExpense,
  listBoothIncome,
  splitProfit,
} from "@/lib/booth-queries";
import { inclusiveEventDays } from "@/lib/booth-split";
import { formatDayShort, formatWeekdayShortThai } from "@/lib/date";
import { formatMoney, toCents } from "@/lib/money";
import { StatsSummaryCards } from "@/components/stats/StatsSummaryCards";
import { DailyProfitChart } from "@/components/stats/DailyProfitChart";
import { BreakdownSection, ProgressBarRow } from "@/components/stats/BreakdownSection";
import {
  CategoryProgressList,
  type CategoryProgressRow,
} from "@/components/stats/CategoryProgressList";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";
import { SplitProfitCard } from "@/components/shared/SplitProfitCard";
import {
  expenseCategoryIcon,
  expenseCategoryLabel,
  incomeCategoryIcon,
  incomeCategoryLabel,
} from "@/lib/expense-categories";
import type { Booth } from "@/types/booth";
import type { User } from "@/types";

function sharePercent(part: string, total: string): number {
  const totalCents = toCents(total);
  if (totalCents <= 0) return 0;
  return (toCents(part) / totalCents) * 100;
}

function aggregateCategoryRows(
  entries: { id: string; category: string; amount: string; entryDate: string; note: string | null }[],
  kind: "income" | "expense",
  totalAmount: string,
): CategoryProgressRow[] {
  const labelFn = kind === "income" ? incomeCategoryLabel : expenseCategoryLabel;
  const iconFn = kind === "income" ? incomeCategoryIcon : expenseCategoryIcon;
  const map = new Map<string, { amountCents: number; count: number }>();

  for (const e of entries) {
    const prev = map.get(e.category) ?? { amountCents: 0, count: 0 };
    map.set(e.category, {
      amountCents: prev.amountCents + toCents(e.amount),
      count: prev.count + 1,
    });
  }

  return [...map.entries()]
    .map(([category, { amountCents, count }]) => {
      const amount = (amountCents / 100).toFixed(2);
      return {
        category,
        label: labelFn(category),
        icon: iconFn(category),
        amount,
        count,
        percentage: sharePercent(amount, totalAmount),
      };
    })
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

/** Booth event Stats — full event summary with chart and progress breakdowns. */
export async function BoothStatsSummary({
  user,
  booth,
}: {
  user: User;
  booth: Booth;
}) {
  const [eventSummary, incomes, expenses, dailySeries, split] = await Promise.all([
    boothSummary(user.id, booth.id),
    listBoothIncome(user.id, booth.id),
    listBoothExpense(user.id, booth.id),
    boothDailyProfitSeries(user.id, booth.id),
    splitProfit(user.id, booth.id),
  ]);

  const event = eventSummary!;
  const entryExpenseTotal = sumDecimals(event.fixedExpense, event.variableExpense);
  const entryTotal = event.incomeCount + event.expenseCount;

  const incomeRows = aggregateCategoryRows(incomes, "income", event.totalIncome);
  const expenseRows = aggregateCategoryRows(expenses, "expense", entryExpenseTotal);
  const incomeEntries = groupEntriesByCategory(incomes);
  const expenseEntries = groupEntriesByCategory(expenses);

  const useWeekdayLabels = inclusiveEventDays(booth.startDate, booth.endDate) <= 7;
  const chartData = dailySeries.map((p) => ({
    date: p.date,
    label: useWeekdayLabels ? formatWeekdayShortThai(p.date) : formatDayShort(p.date),
    profit: Number(p.profit),
    profitDisplay: p.profit,
  }));

  return (
    <>
      <div className="mt-3 px-4">
        <p className="text-center text-sm font-medium text-rz-amber">{booth.name}</p>
        <p className="text-center text-xs text-rz-hint">
          {formatDayShort(booth.startDate)}
          {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
          {" · สรุปทั้งงาน"}
        </p>
      </div>

      <div className="mt-4">
        <StatsSummaryCards
          income={event.totalIncome}
          expense={event.totalExpense}
          profit={event.profit}
          currency={user.currency}
          accent="amber"
        />
        <p className="px-4 pt-2 text-center text-xs text-rz-hint">
          {entryTotal > 0
            ? `${entryTotal.toLocaleString()} รายการทั้งงาน`
            : "ยังไม่มีรายการในงานนี้"}
        </p>
        <p className="px-4 pt-2 text-center">
          <Link
            href={`/booth/${booth.id}/summary`}
            className="text-sm font-medium text-rz-amber"
          >
            ดูสรุปบูธเต็ม →
          </Link>
        </p>
      </div>

      <section className="mt-6 px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-text">กำไรรายวัน</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-3">
          <DailyProfitChart data={chartData} currency={user.currency} accent="amber" />
        </div>
      </section>

      <div className="mt-6 space-y-6">
        <BreakdownSection title="รายรับ">
          <div className="divide-y divide-rz-border">
            <ProgressBarRow
              label="เงินสด"
              amount={formatMoney(event.cashIncome, user.currency)}
              percentage={sharePercent(event.cashIncome, event.totalIncome)}
              tone="amber"
            />
            <ProgressBarRow
              label="เงินโอน"
              amount={formatMoney(event.transferIncome, user.currency)}
              percentage={sharePercent(event.transferIncome, event.totalIncome)}
              tone="amber"
            />
          </div>
        </BreakdownSection>

        <BreakdownSection title="ค่าใช้จ่าย">
          <div className="divide-y divide-rz-border">
            <ProgressBarRow
              label="คงที่"
              amount={formatMoney(event.fixedExpense, user.currency)}
              percentage={sharePercent(event.fixedExpense, entryExpenseTotal)}
              tone="red"
            />
            <ProgressBarRow
              label="ผันแปร"
              amount={formatMoney(event.variableExpense, user.currency)}
              percentage={sharePercent(event.variableExpense, entryExpenseTotal)}
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
              accent="amber"
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

      {split && (
        <SplitProfitCard split={split} currency={user.currency} accent="amber" />
      )}
    </>
  );
}

function sumDecimals(...values: string[]): string {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return (cents / 100).toFixed(2);
}
