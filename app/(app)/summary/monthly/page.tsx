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
        <h1 className="text-lg font-bold text-slate-900">Monthly Summary</h1>
        <Link href="/summary" className="text-sm font-medium text-emerald-700">
          Daily →
        </Link>
      </div>

      <MonthNav month={month} label={formatMonthLabel(month)} />

      <SummaryRows
        income={summary.income}
        expense={summary.expense}
        profit={summary.profit}
        currency={user.currency}
      />

      <div className="mt-6">
        <h2 className="px-4 pb-2 text-sm font-semibold text-slate-500">By day</h2>
        {summary.days.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No entries this month.</p>
        ) : (
          <ul className="mx-4 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">
            {summary.days.map((day) => {
              const sign = moneySign(day.profit);
              const profitColor =
                sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";
              return (
                <li key={day.date}>
                  <Link
                    href={`/summary?date=${day.date}`}
                    className="flex items-center justify-between gap-2 px-4 py-3 active:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-700">
                      {formatDayShort(day.date)}
                    </span>
                    <span className="text-right text-xs tabular-nums text-slate-500">
                      <span className="text-emerald-600">+{formatMoney(day.income, user.currency)}</span>
                      {" "}
                      <span className="text-red-600">−{formatMoney(day.expense, user.currency)}</span>
                      {" = "}
                      <span className={`font-semibold ${profitColor}`}>
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
