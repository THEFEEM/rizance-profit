import { computeProfit, formatMoney, moneySign, toCents } from "@/lib/money";

/** Booth-mode budget strip — used / total with progress; red when over budget. */
export function BoothBudgetBar({
  totalBudget,
  totalExpense,
  currency = "THB",
}: {
  totalBudget: string;
  totalExpense: string;
  currency?: string;
}) {
  const remaining = computeProfit(totalBudget, totalExpense);
  const remainingSign = moneySign(remaining);
  const overBudget = remainingSign < 0;
  const overAmount = overBudget ? formatMoney(remaining.slice(1), currency) : null;

  const budgetCents = toCents(totalBudget);
  const usedCents = toCents(totalExpense);
  const fillPct =
    budgetCents > 0 ? Math.min(100, Math.round((usedCents / budgetCents) * 100)) : 0;

  return (
    <section className="px-4 pt-3">
      <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] text-rz-hint">งบประมาณ</p>
          <p className="text-[11px] text-rz-muted">
            ใช้ไป / ทั้งหมด{" "}
            <span className="rz-tabular font-medium text-rz-text">
              {formatMoney(totalExpense, currency)} / {formatMoney(totalBudget, currency)}
            </span>
          </p>
        </div>

        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-rz-elevated">
          <div
            className={`h-full rounded-full transition-[width] ${overBudget ? "bg-rz-red" : "bg-rz-amber"}`}
            style={{ width: `${fillPct}%` }}
            role="progressbar"
            aria-valuenow={fillPct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-rz-muted">
            ใช้ไป{" "}
            <span className="rz-tabular font-medium text-rz-text">
              {formatMoney(totalExpense, currency)}
            </span>
          </span>
          {overBudget ? (
            <span className="rz-tabular font-medium text-rz-red">
              เกินงบ {overAmount}
            </span>
          ) : (
            <span className="text-rz-muted">
              เหลือ{" "}
              <span className="rz-tabular font-medium text-rz-text">
                {formatMoney(remaining, currency)}
              </span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
