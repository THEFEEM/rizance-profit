import { formatMoney, moneySign } from "@/lib/money";
import type { BoothSummary } from "@/types/booth";

function SummaryLine({
  label,
  amount,
  currency,
  tone = "neutral",
}: {
  label: string;
  amount: string;
  currency: string;
  tone?: "income" | "expense" | "neutral" | "muted";
}) {
  const color =
    tone === "income"
      ? "text-emerald-600"
      : tone === "expense"
        ? "text-red-600"
        : tone === "muted"
          ? "text-slate-400"
          : "text-slate-700";

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

export function BoothSummaryCard({
  summary,
  currency = "THB",
  compact = false,
}: {
  summary: BoothSummary;
  currency?: string;
  /** Hub preview — hides section headers, smaller profit. */
  compact?: boolean;
}) {
  const sign = moneySign(summary.profit);
  const profitColor =
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  return (
    <div className={compact ? "" : "px-4 pb-6"}>
      {!compact && (
        <section className="py-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            กำไร/ขาดทุน
          </p>
          <p
            className={`mt-2 break-all text-5xl font-extrabold leading-tight tracking-tight ${profitColor}`}
          >
            {formatMoney(summary.profit, currency)}
          </p>
        </section>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <SummaryLine
            label="งบเริ่มต้น"
            amount={summary.booth.startingBudget}
            currency={currency}
            tone="muted"
          />
          <p className="text-xs text-slate-400">แสดงเพื่ออ้างอิง — ไม่หักจากกำไร</p>
        </div>

        <div className="border-b border-slate-100 px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              รายรับ
            </p>
          )}
          <SummaryLine
            label="รายรับเงินสด"
            amount={summary.cashIncome}
            currency={currency}
            tone="income"
          />
          <SummaryLine
            label="รายรับโอน"
            amount={summary.transferIncome}
            currency={currency}
            tone="income"
          />
          <SummaryLine
            label="รายรับรวม"
            amount={summary.totalIncome}
            currency={currency}
            tone="income"
          />
        </div>

        <div className="border-b border-slate-100 px-4 py-1">
          {!compact && (
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              ค่าใช้จ่าย
            </p>
          )}
          <SummaryLine
            label="ค่าใช้จ่ายคงที่"
            amount={summary.fixedExpense}
            currency={currency}
            tone="expense"
          />
          <SummaryLine
            label="ค่าใช้จ่ายผันแปร"
            amount={summary.variableExpense}
            currency={currency}
            tone="expense"
          />
          <SummaryLine
            label="ค่าใช้จ่ายรวม"
            amount={summary.totalExpense}
            currency={currency}
            tone="expense"
          />
        </div>

        {compact && (
          <div className="px-4 py-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              กำไร/ขาดทุน
            </p>
            <p className={`mt-1 text-3xl font-extrabold tabular-nums ${profitColor}`}>
              {formatMoney(summary.profit, currency)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
