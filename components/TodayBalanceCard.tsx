import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
}

/**
 * Regular-mode Today hero: month sales + month profit + cash/transfer on-hand breakdown.
 */
export function TodayBalanceCard({
  totalSales,
  cumulativeProfit,
  totalOnHand,
  cashOnHand,
  transferOnHand,
  currency = "THB",
  salesLabel = "ยอดขายรวม",
  profitLabel = "กำไรสะสม",
}: {
  totalSales: string;
  cumulativeProfit: string;
  totalOnHand: string;
  cashOnHand: string;
  transferOnHand: string;
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

        <div>
          <p className="text-[11px] text-rz-hint">{profitLabel}</p>
          <p
            className={`rz-tabular mt-0.5 text-base font-medium ${profitColor(cumulativeProfit)}`}
          >
            {formatMoney(cumulativeProfit, currency)}
          </p>
        </div>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div>
          <p className="text-[11px] text-rz-hint">เงินคงเหลือ</p>
          <p className={`rz-tabular mt-0.5 text-xl font-medium ${profitColor(totalOnHand)}`}>
            {formatMoney(totalOnHand, currency)}
          </p>
          <div className="mt-2 space-y-1 pl-1">
            <p className={`rz-tabular text-[13px] ${profitColor(cashOnHand)}`}>
              เงินสด {formatMoney(cashOnHand, currency)}
            </p>
            <p className={`rz-tabular text-[13px] ${profitColor(transferOnHand)}`}>
              เงินโอน {formatMoney(transferOnHand, currency)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
