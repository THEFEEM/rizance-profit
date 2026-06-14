import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { monthlySummary } from "@/lib/queries";
import { currentMonth, isValidMonth, formatMonthLabel, formatDayShort } from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import { MonthNav } from "@/components/MonthNav";
import { SummaryRows } from "@/components/SummaryRows";

export const dynamic = "force-dynamic";

export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const month = params.month && isValidMonth(params.month) ? params.month : currentMonth();
  const summary = await monthlySummary(user.id, month);

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <h1 className="text-lg font-medium text-rz-text">Monthly Summary</h1>
        <Link href="/summary" className="text-sm font-medium text-rz-green active:opacity-90">
          Daily →
        </Link>
      </div>

      <MonthNav month={month} label={formatMonthLabel(month)} />

      <div className="mt-4">
        <SummaryRows
          income={summary.income}
          expense={summary.expense}
          profit={summary.profit}
          currency={user.currency}
          appearance="stats"
        />
      </div>

      <div className="mt-6">
        <h2 className="px-4 pb-2 text-sm font-medium text-rz-muted">By day</h2>
        {summary.days.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-rz-hint">No entries this month.</p>
        ) : (
          <ul className="mx-4 divide-y divide-rz-border overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
            {summary.days.map((day) => {
              const sign = moneySign(day.profit);
              const profitColor =
                sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
              return (
                <li key={day.date}>
                  <Link
                    href={`/summary?date=${day.date}`}
                    className="tap-target flex items-center justify-between gap-2 px-4 py-3.5 active:bg-rz-elevated"
                  >
                    <span className="text-sm font-medium text-rz-text">
                      {formatDayShort(day.date)}
                    </span>
                    <span className="rz-tabular text-right text-xs text-rz-muted">
                      <span className="text-rz-green">+{formatMoney(day.income, user.currency)}</span>{" "}
                      <span className="text-rz-red">−{formatMoney(day.expense, user.currency)}</span>
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
    </div>
  );
}
