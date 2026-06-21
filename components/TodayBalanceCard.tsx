import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
}

/**
 * Regular-mode Today hero: total sales + cumulative / today profit + cash in hand.
 */
export function TodayBalanceCard({
  totalSales,
  cumulativeProfit,
  todayProfit,
  cashInHand,
  currency = "THB",
  salesLabel = "ยอดขายรวม",
  profitLabel = "กำไรสะสม",
}: {
  totalSales: string;
  cumulativeProfit: string;
  todayProfit: string;
  cashInHand?: string;
  currency?: string;
  salesLabel?: string;
  profitLabel?: string;
}) {
  return (
    <section className="px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-[18px] py-[18px]">
        <p className="text-[11px] text-rz-hint">{salesLabel}</p>
        <p className="rz-tabular mt-1 break-all text-[32px] font-medium leading-tight tracking-[-0.5px] text-rz-green">
          {formatMoney(totalSales, currency)}
        </p>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-rz-hint">{profitLabel}</p>
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
            {cashInHand !== undefined && (
              <div className="mt-2 border-t-[0.5px] border-rz-border pt-2">
                <p className="text-[11px] text-rz-hint">เงินสดในมือ</p>
                <p className={`rz-tabular mt-0.5 text-sm font-medium ${profitColor(cashInHand)}`}>
                  {formatMoney(cashInHand, currency)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
