import { formatMoney, moneySign, toCents } from "@/lib/money";

function profitRatePercent(income: string, profit: string): string {
  const incomeCents = toCents(income);
  if (incomeCents <= 0) return "0";
  return Math.round((toCents(profit) / incomeCents) * 100).toString();
}

function SummaryCard({
  label,
  value,
  tone,
  accent = "green",
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "muted" | "amber" | "purple";
  accent?: "green" | "amber" | "purple";
}) {
  const valueClass =
    tone === "green"
      ? "text-rz-green"
      : tone === "amber"
        ? "text-rz-amber"
        : tone === "purple"
          ? "text-rz-purple"
          : tone === "red"
            ? "text-rz-red"
            : "text-rz-hint";

  const borderClass =
    accent === "amber" && (tone === "green" || tone === "amber")
      ? "border-rz-amber/30"
      : accent === "purple" && tone === "purple"
        ? "border-rz-purple/30"
        : "border-rz-border";

  return (
    <div
      className={`rounded-[14px] border-[0.5px] bg-rz-card px-4 py-3.5 ${borderClass}`}
    >
      <p className="text-xs text-rz-muted">{label}</p>
      <p className={`mt-1 text-lg font-medium rz-tabular ${valueClass}`}>{value}</p>
    </div>
  );
}

/** Shop/booth profit cards (default) or org budget cards (variant="budget"). */
export function StatsSummaryCards({
  income,
  expense,
  profit,
  currency = "THB",
  accent = "green",
  variant = "profit",
  remaining,
  budgetUsedPct = 0,
}: {
  income: string;
  expense: string;
  profit?: string;
  currency?: string;
  accent?: "green" | "amber" | "purple";
  variant?: "profit" | "budget";
  remaining?: string;
  budgetUsedPct?: number;
}) {
  if (variant === "budget") {
    const remain = remaining ?? "0.00";
    const remainSign = moneySign(remain);
    const remainTone = remainSign > 0 ? "green" : remainSign < 0 ? "red" : "muted";
    const pctDisplay = `${Math.min(100, Math.max(0, budgetUsedPct)).toFixed(1)}%`;

    return (
      <div className="grid grid-cols-2 gap-3 px-4">
        <SummaryCard
          label="รายรับรวม"
          value={formatMoney(income, currency)}
          tone="purple"
          accent="purple"
        />
        <SummaryCard label="รายจ่ายรวม" value={formatMoney(expense, currency)} tone="red" />
        <SummaryCard
          label="งบคงเหลือ"
          value={formatMoney(remain, currency)}
          tone={remainTone}
        />
        <SummaryCard label="ใช้ไป" value={pctDisplay} tone="muted" />
      </div>
    );
  }

  const profitValue = profit ?? "0.00";
  const profitSign = moneySign(profitValue);
  const profitTone =
    profitSign > 0
      ? accent === "amber"
        ? "amber"
        : accent === "purple"
          ? "purple"
          : "green"
      : profitSign < 0
        ? "red"
        : "muted";
  const incomeTone =
    accent === "amber" ? "amber" : accent === "purple" ? "purple" : "green";

  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      <SummaryCard
        label="รายรับรวม"
        value={formatMoney(income, currency)}
        tone={incomeTone}
        accent={accent}
      />
      <SummaryCard label="รายจ่ายรวม" value={formatMoney(expense, currency)} tone="red" />
      <SummaryCard
        label="กำไรสุทธิ"
        value={formatMoney(profitValue, currency)}
        tone={profitTone}
        accent={accent}
      />
      <SummaryCard
        label="อัตรากำไร"
        value={`${profitRatePercent(income, profitValue)}%`}
        tone="muted"
      />
    </div>
  );
}
