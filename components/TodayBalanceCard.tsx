import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
}

/**
 * Regular-mode Today hero: total sales + cumulative / today profit.
 */
export function TodayBalanceCard({
  totalSales,
  cumulativeProfit,
  todayProfit,
  currency = "THB",
}: {
  totalSales: string;
  cumulativeProfit: string;
  todayProfit: string;
  currency?: string;
}) {
  return (
    <section className="px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-[18px] py-[18px]">
        <p className="text-[11px] text-rz-hint">ยอดขายรวม</p>
        <p className="rz-tabular mt-1 break-all text-[32px] font-medium leading-tight tracking-[-0.5px] text-rz-green">
          {formatMoney(totalSales, currency)}
        </p>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-rz-hint">กำไรสะสม</p>
            <p
              className={`rz-tabular mt-0.5 text-base font-medium ${profitColor(cumulativeProfit)}`}
            >
              {formatMoney(cumulativeProfit, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-rz-hint">กำไรวันนี้</p>
            <p className={`rz-tabular mt-0.5 text-base font-medium ${profitColor(todayProfit)}`}>
              {formatMoney(todayProfit, currency)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
