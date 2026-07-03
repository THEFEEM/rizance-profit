import { formatMoney, moneySign } from "@/lib/money";
import type { SplitProfitResult } from "@/types/booth";

export function BoothSummaryNetCard({
  split,
  currency = "THB",
}: {
  split: SplitProfitResult;
  currency?: string;
}) {
  const netSign = moneySign(split.netProfit);
  const netColor =
    netSign > 0 ? "text-rz-green" : netSign < 0 ? "text-rz-red" : "text-rz-hint";

  return (
    <section className="mt-6 px-4 pb-8">
      <div
        className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-logo-border px-4 py-5"
        style={{
          background: "linear-gradient(135deg, #16352A, #14202E)",
        }}
      >
        <p className="text-sm font-medium text-rz-muted">กำไรสุทธิ (แบ่งได้)</p>
        <p className={`mt-2 break-all rz-tabular text-[30px] font-medium leading-tight ${netColor}`}>
          {formatMoney(split.netProfit, currency)}
        </p>
        {split.isLoss && (
          <p className="mt-1 text-sm font-medium text-rz-red">ขาดทุน</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-rz-hint">
          รับ{" "}
          <span className="font-medium text-rz-green">
            {formatMoney(split.totalIncome, currency)}
          </span>
          {" − "}
          จ่าย{" "}
          <span className="font-medium text-rz-red">
            {formatMoney(split.totalExpense, currency)}
          </span>
          {" − "}
          ค่าแรง{" "}
          <span className="font-medium text-rz-red">
            {formatMoney(split.wageCost, currency)}
          </span>
        </p>
      </div>
    </section>
  );
}
