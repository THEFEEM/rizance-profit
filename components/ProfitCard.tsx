import { formatMoney, moneySign } from "@/lib/money";

/**
 * The hero. Profit is the largest element on screen:
 * green if positive, red if negative, gray if zero.
 */
export function ProfitCard({
  profit,
  income,
  expense,
  currency = "THB",
  label = "TODAY'S PROFIT",
}: {
  profit: string;
  income: string;
  expense: string;
  currency?: string;
  label?: string;
}) {
  const sign = moneySign(profit);
  const color =
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  return (
    <section className="px-4 py-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 break-all text-6xl font-extrabold leading-tight tracking-tight ${color}`}>
        {formatMoney(profit, currency)}
      </p>
      <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-500">
        <span>
          In <span className="font-semibold text-emerald-600">{formatMoney(income, currency)}</span>
        </span>
        <span aria-hidden>·</span>
        <span>
          Out <span className="font-semibold text-red-600">{formatMoney(expense, currency)}</span>
        </span>
      </div>
    </section>
  );
}
