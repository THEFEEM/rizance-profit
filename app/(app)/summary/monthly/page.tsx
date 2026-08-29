import Link from "next/link";
import { redirect } from "next/navigation";
import { DateNav } from "@/components/DateNav";
import { MonthNav } from "@/components/MonthNav";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { MonthHistoryList } from "@/components/summary/MonthHistoryList";
import { MonthlyYearOverview } from "@/components/summary/MonthlyYearOverview";
import { SummaryModeToggle } from "@/components/summary/SummaryModeToggle";
import { SummaryRows } from "@/components/SummaryRows";
import {
  formatDateLabel,
  formatDayShort,
  formatMonthLabel,
  today,
} from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import {
  dailySummary,
  listExpenseByDate,
  listIncomeByDate,
  monthlySummary,
  monthsWithActivity,
  yearMonthlySeries,
} from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { parseShopSummaryParams, SHOP_SUMMARY_LABELS } from "@/lib/summary-params";
import type { PaymentMethod } from "@/types/booth";

export const dynamic = "force-dynamic";

export default async function ShopSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; month?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const { mode, date, month } = parseShopSummaryParams(params);
  const maxDate = today();

  if (mode === "daily") {
    const [summary, incomes, expenses] = await Promise.all([
      dailySummary(user.id, date),
      listIncomeByDate(user.id, date),
      listExpenseByDate(user.id, date),
    ]);

    const entries: EntryRow[] = [
      ...incomes.map((i) => ({
        id: i.id,
        kind: "income" as const,
        amount: i.amount,
        note: i.note,
        category: i.category,
        paymentMethod: i.paymentMethod as PaymentMethod | undefined,
        createdAt: i.createdAt,
        voided: i.voidedAt != null,
      })),
      ...expenses.map((e) => ({
        id: e.id,
        kind: "expense" as const,
        amount: e.amount,
        note: e.note,
        category: e.category,
        paymentMethod: (e.paymentMethod ?? "cash") as PaymentMethod,
        createdAt: e.createdAt,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return (
      <div className="pb-6">
        <div className="flex items-center justify-between px-4 pt-3">
          <h1 className="text-lg font-medium text-rz-text">สรุปรายวัน</h1>
          <SummaryModeToggle mode={mode} date={date} month={month} />
        </div>

        <DateNav date={date} label={formatDateLabel(date)} maxDate={maxDate} />

        <div className="mt-4">
          <SummaryRows
            income={summary.income}
            expense={summary.expense}
            profit={summary.profit}
            currency={user.currency}
            labels={SHOP_SUMMARY_LABELS}
            appearance="stats"
          />
        </div>

        <div className="mt-6">
          <h2 className="px-4 pb-2 text-sm font-medium text-rz-muted">รายการ</h2>
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-rz-hint">ยังไม่มีรายการในวันนี้</p>
          ) : (
            <div className="mx-4 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
              <EntryList entries={entries} currency={user.currency} appearance="today" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const chartYear = Number(month.slice(0, 4));
  const [summary, monthHistory, yearlySeries] = await Promise.all([
    monthlySummary(user.id, month),
    monthsWithActivity(user.id, 12),
    yearMonthlySeries(user.id, chartYear),
  ]);

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">สรุปรายเดือน</h1>
        <SummaryModeToggle mode={mode} date={date} month={month} />
      </div>

      <MonthNav month={month} label={formatMonthLabel(month)} />

      <div className="mt-4">
        <SummaryRows
          income={summary.income}
          expense={summary.expense}
          profit={summary.profit}
          currency={user.currency}
          labels={SHOP_SUMMARY_LABELS}
          appearance="stats"
        />
      </div>

      <MonthlyYearOverview
        series={yearlySeries}
        year={chartYear}
        currency={user.currency}
      />

      <div className="mt-6">
        <h2 className="px-4 pb-2 text-sm font-medium text-rz-muted">รายวัน</h2>
        {summary.days.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-rz-hint">ยังไม่มีรายการในเดือนนี้</p>
        ) : (
          <ul className="mx-4 divide-y divide-rz-border overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            {summary.days.map((day) => {
              const sign = moneySign(day.profit);
              const profitColor =
                sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
              return (
                <li key={day.date}>
                  <Link
                    href={`/summary/monthly?mode=daily&date=${day.date}`}
                    className="tap-target flex items-center justify-between gap-2 px-4 py-3.5 active:bg-rz-elevated"
                  >
                    <span className="text-sm font-medium text-rz-text">
                      {formatDayShort(day.date)}
                    </span>
                    <span className="rz-tabular text-right text-xs text-rz-muted">
                      <span className="text-rz-green">
                        +{formatMoney(day.income, user.currency)}
                      </span>{" "}
                      <span className="text-rz-red">
                        −{formatMoney(day.expense, user.currency)}
                      </span>
                      {" = "}
                      <span className={`font-medium ${profitColor}`}>
                        {formatMoney(day.profit, user.currency)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MonthHistoryList
        months={monthHistory}
        activeMonth={month}
        currency={user.currency}
      />
    </div>
  );
}
