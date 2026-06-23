import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
}

function GridCell({
  label,
  amount,
  currency,
  amountClassName = "text-base",
}: {
  label: string;
  amount: string;
  currency: string;
  amountClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-rz-hint">{label}</p>
      <p
        className={`rz-tabular mt-0.5 break-all font-medium ${amountClassName} ${profitColor(amount)}`}
      >
        {formatMoney(amount, currency)}
      </p>
    </div>
  );
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
        <div>
          <p className="text-[11px] text-rz-hint">{salesLabel}</p>
          <p className="rz-tabular mt-1 break-all text-[32px] font-medium leading-tight tracking-[-0.5px] text-rz-green">
            {formatMoney(totalSales, currency)}
          </p>
        </div>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <GridCell
            label={profitLabel}
            amount={cumulativeProfit}
            currency={currency}
          />
          <GridCell
            label="เงินคงเหลือ"
            amount={totalOnHand}
            currency={currency}
            amountClassName="text-xl"
          />
        </div>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <GridCell label="เงินสด" amount={cashOnHand} currency={currency} />
          <GridCell label="เงินโอน" amount={transferOnHand} currency={currency} />
        </div>
      </div>
    </section>
  );
}
