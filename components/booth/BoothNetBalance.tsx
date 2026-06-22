import { computeProfit, formatMoney, sumDecimals } from "@/lib/money";

export function boothNetBalance(
  totalBudget: string,
  totalExpense: string,
  totalIncome: string,
): { remainingBudget: string; netBalance: string } {
  const remainingBudget = computeProfit(totalBudget, totalExpense);
  const netBalance = sumDecimals(remainingBudget, totalIncome);
  return { remainingBudget, netBalance };
}

/** เงินคงเหลือ = งบคงเหลือ + รายรับรวม — matches booth Today hero. */
export function BoothNetBalanceHighlight({
  remainingBudget,
  totalIncome,
  netBalance,
  currency = "THB",
}: {
  remainingBudget: string;
  totalIncome: string;
  netBalance: string;
  currency?: string;
}) {
  return (
    <div className="mx-3 mb-3 rounded-[11px] border-[0.5px] border-rz-blue/30 bg-[#15293F]/60 px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-rz-border bg-[#15293F] text-rz-blue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 8h16v10H4V8ZM4 8V6.5A1.5 1.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1M16 13h2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rz-text">เงินคงเหลือ</p>
          <p className="text-xs text-rz-hint">
            งบคงเหลือ {formatMoney(remainingBudget, currency)} + รายรับรวม{" "}
            {formatMoney(totalIncome, currency)}
          </p>
        </div>
        <p className="rz-tabular text-base font-medium text-rz-blue">
          {formatMoney(netBalance, currency)}
        </p>
      </div>
    </div>
  );
}

export function BoothNetBalanceRow({
  remainingBudget,
  totalIncome,
  netBalance,
  currency = "THB",
}: {
  remainingBudget: string;
  totalIncome: string;
  netBalance: string;
  currency?: string;
}) {
  return (
    <div className="border-t-[0.5px] border-rz-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-rz-muted">เงินคงเหลือ</span>
        <span className="rz-tabular text-sm font-medium text-rz-blue">
          {formatMoney(netBalance, currency)}
        </span>
      </div>
      <p className="mt-1 text-xs text-rz-hint">
        งบคงเหลือ {formatMoney(remainingBudget, currency)} + รายรับรวม{" "}
        {formatMoney(totalIncome, currency)}
      </p>
    </div>
  );
}
