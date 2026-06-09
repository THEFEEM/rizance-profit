import { formatMoney, moneySign } from "@/lib/money";

const DEFAULT_LABELS = { income: "Income", expense: "Expense", profit: "PROFIT" };

/** Income / expense / profit breakdown rows used on summary pages. */
export function SummaryRows({
  income,
  expense,
  profit,
  currency = "THB",
  labels = DEFAULT_LABELS,
}: {
  income: string;
  expense: string;
  profit: string;
  currency?: string;
  labels?: { income: string; expense: string; profit: string };
}) {
  const sign = moneySign(profit);
  const profitColor =
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  return (
    <div className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="divide-y divide-slate-100 px-4">
        <Row label={labels.income} value={formatMoney(income, currency)} valueClass="text-slate-900" />
        <Row label={labels.expense} value={formatMoney(expense, currency)} valueClass="text-slate-900" />
        <Row
          label={labels.profit}
          value={formatMoney(profit, currency)}
          valueClass={`text-lg font-extrabold ${profitColor}`}
          bold
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  bold = false,
}: {
  label: string;
  value: string;
  valueClass: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <span className={`text-sm ${bold ? "font-bold text-slate-900" : "text-slate-500"}`}>
        {label}
      </span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
