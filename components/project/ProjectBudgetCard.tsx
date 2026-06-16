import { formatMoney, moneySign } from "@/lib/money";
import type { ActivitySummary } from "@/types/project";

export function ProjectBudgetCard({
  summary,
  currency = "THB",
  title = "สรุปงบประมาณ",
  fundingLabel = "รายรับรวม",
}: {
  summary: Pick<
    ActivitySummary,
    | "budgetTarget"
    | "totalFunding"
    | "paidFunding"
    | "committedFunding"
    | "totalSpent"
    | "paidSpent"
    | "committedSpent"
    | "remaining"
    | "budgetRemaining"
    | "budgetUsedPct"
    | "isOverBudget"
  >;
  currency?: string;
  title?: string;
  fundingLabel?: string;
}) {
  const remainSign = moneySign(summary.remaining);
  const remainColor =
    remainSign > 0 ? "text-rz-green" : remainSign < 0 ? "text-rz-red" : "text-rz-hint";
  const pct = Math.min(100, Math.max(0, summary.budgetUsedPct));

  return (
    <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4">
      <h2 className="text-sm font-medium text-rz-muted">{title}</h2>

      <div className="mt-3 space-y-2 text-sm rz-tabular">
        <div className="flex justify-between gap-2">
          <span className="text-rz-hint">งบตั้งต้น</span>
          <span className="text-rz-text">{formatMoney(summary.budgetTarget, currency)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-rz-blue">{fundingLabel}</span>
          <span className="text-rz-blue">{formatMoney(summary.totalFunding, currency)}</span>
        </div>
        <p className="text-[11px] text-rz-placeholder">
          จ่ายจริง {formatMoney(summary.paidFunding, currency)} · ผูกพัน{" "}
          {formatMoney(summary.committedFunding, currency)}
        </p>
        <div className="flex justify-between gap-2">
          <span className="text-rz-red">ใช้ไปแล้ว</span>
          <span className="text-rz-red">{formatMoney(summary.totalSpent, currency)}</span>
        </div>
        <p className="text-[11px] text-rz-placeholder">
          จ่ายจริง {formatMoney(summary.paidSpent, currency)} · ผูกพัน{" "}
          {formatMoney(summary.committedSpent, currency)}
        </p>
        <div className="flex justify-between gap-2 border-t-[0.5px] border-rz-border pt-2">
          <span className="text-rz-hint">คงเหลือ</span>
          <span className={`font-medium ${remainColor}`}>
            {formatMoney(summary.remaining, currency)}
          </span>
        </div>
      </div>

      {Number(summary.budgetTarget) > 0 && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-rz-elevated">
            <div
              className={`h-full rounded-full transition-all ${summary.isOverBudget ? "bg-rz-red" : "bg-rz-blue"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-rz-hint">
            ใช้ไป {summary.budgetUsedPct.toFixed(1)}%
            {summary.isOverBudget ? (
              <span className="text-rz-red"> · เกินงบ!</span>
            ) : (
              <span className="text-rz-green"> · อยู่ในงบ</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
