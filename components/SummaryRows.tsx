import { formatMoney, moneySign } from "@/lib/money";

const DEFAULT_LABELS = { income: "Income", expense: "Expense", profit: "PROFIT" };

/** Income / expense / profit breakdown rows used on summary pages. */
export function SummaryRows({
  income,
  expense,
  profit,
  currency = "THB",
  labels = DEFAULT_LABELS,
  appearance = "stats",
}: {
  income: string;
  expense: string;
  profit: string;
  currency?: string;
  labels?: { income: string; expense: string; profit: string };
  appearance?: "default" | "stats";
}) {
  const sign = moneySign(profit);
  const isStats = appearance === "stats";

  const profitColor = isStats
    ? sign > 0
      ? "text-rz-green"
      : sign < 0
        ? "text-rz-red"
        : "text-rz-hint"
    : sign > 0
      ? "text-emerald-600"
      : sign < 0
        ? "text-red-600"
        : "text-slate-400";

  if (!isStats) {
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

  return (
    <div className="mx-4 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="divide-y divide-rz-border px-4">
        <Row
          label={labels.income}
          value={formatMoney(income, currency)}
          valueClass="text-rz-text"
          labelClass="text-rz-muted"
        />
        <Row
          label={labels.expense}
          value={formatMoney(expense, currency)}
          valueClass="text-rz-text"
          labelClass="text-rz-muted"
        />
        <Row
          label={labels.profit}
          value={formatMoney(profit, currency)}
          valueClass={`text-lg font-medium ${profitColor}`}
          labelClass="text-rz-text"
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
  labelClass = "text-slate-500",
  bold = false,
}: {
  label: string;
  value: string;
  valueClass: string;
  labelClass?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <span className={`text-sm ${bold ? "font-medium text-rz-text" : labelClass}`}>{label}</span>
      <span className={`rz-tabular text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
