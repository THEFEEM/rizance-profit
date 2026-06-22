import { formatMoney, moneySign } from "@/lib/money";

function profitColor(amount: string): string {
  const sign = moneySign(amount);
  return sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";
}

/** Booth-mode Today hero: event total sales + cash in hand + booth profit. */
export function BoothTodayHeroCard({
  totalSales,
  cashInHand,
  boothProfit,
  currency = "THB",
}: {
  totalSales: string;
  cashInHand: string;
  boothProfit: string;
  currency?: string;
}) {
  return (
    <section className="px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-[18px] py-[18px]">
        <p className="text-[11px] text-rz-hint">ยอดขายรวมของบูธ</p>
        <p className="rz-tabular mt-1 break-all text-[32px] font-medium leading-tight tracking-[-0.5px] text-rz-text">
          {formatMoney(totalSales, currency)}
        </p>

        <div className="my-3 border-t-[0.5px] border-rz-border" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-rz-hint">เงินคงเหลือ</p>
            <p className="rz-tabular mt-0.5 text-base font-medium text-rz-green">
              {formatMoney(cashInHand, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-rz-hint">กำไรบูธ</p>
            <p className={`rz-tabular mt-0.5 text-base font-medium ${profitColor(boothProfit)}`}>
              {formatMoney(boothProfit, currency)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
