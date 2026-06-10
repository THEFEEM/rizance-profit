import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";
}

/**
 * Regular-mode Today hero: cumulative profit (ยอดสะสม) with today's breakdown below.
 */
export function TodayBalanceCard({
  cumulativeProfit,
  todayProfit,
  currency = "THB",
}: {
  cumulativeProfit: string;
  todayProfit: string;
  currency?: string;
}) {
  return (
    <section className="px-4 py-6 text-center">
      <p className="text-sm font-semibold tracking-wide text-slate-400">ยอดสะสม</p>
      <p
        className={`mt-1 break-all text-6xl font-extrabold leading-tight tracking-tight ${profitColor(cumulativeProfit)}`}
      >
        {formatMoney(cumulativeProfit, currency)}
      </p>

      <p className="mt-3 text-sm text-slate-600">
        กำไรวันนี้{" "}
        <span className={`font-semibold ${profitColor(todayProfit)}`}>
          {formatMoney(todayProfit, currency)}
        </span>
      </p>
    </section>
  );
}
