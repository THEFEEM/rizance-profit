import Link from "next/link";
import { formatMonthLabel } from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import type { MonthActivity } from "@/types";

export function MonthHistoryList({
  months,
  activeMonth,
  currency,
}: {
  months: MonthActivity[];
  activeMonth: string;
  currency: string;
}) {
  const rows = months.filter((m) => m.month !== activeMonth);
  if (rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="px-4 pb-2 text-sm font-medium text-rz-muted">เดือนก่อนหน้า</h2>
      <ul className="mx-4 divide-y divide-rz-border overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        {rows.map((m) => {
          const sign = moneySign(m.profit);
          const profitColor =
            sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
          return (
            <li key={m.month}>
              <Link
                href={`/summary/monthly?mode=monthly&month=${m.month}`}
                className="tap-target flex items-center justify-between gap-2 px-4 py-3.5 active:bg-rz-elevated"
              >
                <span className="text-sm font-medium text-rz-text">
                  {formatMonthLabel(m.month)}
                </span>
                <span className="rz-tabular text-right text-xs text-rz-muted">
                  <span className="text-rz-green">+{formatMoney(m.income, currency)}</span>{" "}
                  <span className="text-rz-red">−{formatMoney(m.expense, currency)}</span>
                  {" = "}
                  <span className={`font-medium ${profitColor}`}>
                    {formatMoney(m.profit, currency)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
