import { computeProfit, formatMoney, moneySign } from "@/lib/money";

/** Booth-mode budget strip — display only; remaining may go negative. */
export function BoothBudgetBar({
  startingBudget,
  totalExpense,
  currency = "THB",
}: {
  startingBudget: string;
  totalExpense: string;
  currency?: string;
}) {
  const remaining = computeProfit(startingBudget, totalExpense);
  const remainingSign = moneySign(remaining);
  const remainingColor =
    remainingSign < 0 ? "text-red-600" : remainingSign > 0 ? "text-emerald-700" : "text-slate-700";

  return (
    <div className="mx-4 mt-3 flex gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">งบทั้งหมด</p>
        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">
          {formatMoney(startingBudget, currency)}
        </p>
      </div>
      <div className="w-px shrink-0 bg-slate-100" aria-hidden />
      <div className="min-w-0 flex-1 text-right">
        <p className="text-xs text-slate-500">งบคงเหลือ</p>
        <p className={`mt-0.5 text-sm font-bold tabular-nums ${remainingColor}`}>
          {formatMoney(remaining, currency)}
        </p>
      </div>
    </div>
  );
}
