import { formatMoney, moneySign, toCents } from "@/lib/money";

function profitRatePercent(income: string, profit: string): string {
  const incomeCents = toCents(income);
  if (incomeCents <= 0) return "0";
  return Math.round((toCents(profit) / incomeCents) * 100).toString();
}

function savingsRateTone(pct: number): "green" | "amber" | "red" {
  if (pct >= 70) return "green";
  if (pct >= 30) return "amber";
  return "red";
}

function SummaryCard({
  label,
  value,
  tone,
  accent = "green",
  progressPct,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "muted" | "amber" | "purple" | "rose";
  accent?: "green" | "amber" | "purple" | "rose";
  progressPct?: number;
}) {
  const valueClass =
    tone === "green"
      ? "text-rz-green"
      : tone === "amber"
        ? "text-rz-amber"
        : tone === "purple"
          ? "text-rz-purple"
          : tone === "rose"
            ? "text-rz-rose"
            : tone === "red"
              ? "text-rz-red"
              : "text-rz-hint";

  const borderClass =
    accent === "rose" && tone === "rose"
      ? "border-rz-rose/30"
      : accent === "amber" && (tone === "green" || tone === "amber")
        ? "border-rz-amber/30"
        : accent === "purple" && tone === "purple"
          ? "border-rz-purple/30"
          : "border-rz-border";

  const progressBarClass =
    tone === "green"
      ? "bg-rz-green"
      : tone === "amber"
        ? "bg-rz-amber"
        : tone === "red"
          ? "bg-rz-red"
          : "bg-rz-elevated";

  return (
    <div
      className={`rounded-[14px] border-[0.5px] bg-rz-card px-4 py-3.5 ${borderClass}`}
    >
      <p className="text-xs text-rz-muted">{label}</p>
      <p className={`mt-1 text-lg font-medium rz-tabular ${valueClass}`}>{value}</p>
      {progressPct !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rz-elevated">
          <div
            className={`h-full rounded-full ${progressBarClass}`}
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Shop/booth profit cards (default), org budget cards, or personal savings cards. */
export function StatsSummaryCards({
  income,
  expense,
  profit,
  currency = "THB",
  accent = "green",
  variant = "profit",
  remaining,
  budgetUsedPct = 0,
  balance,
}: {
  income: string;
  expense: string;
  profit?: string;
  currency?: string;
  accent?: "green" | "amber" | "purple" | "rose";
  variant?: "profit" | "budget" | "personal";
  remaining?: string;
  budgetUsedPct?: number;
  balance?: string;
}) {
  if (variant === "personal") {
    const balanceValue = balance ?? profit ?? "0.00";
    const balanceSign = moneySign(balanceValue);
    const balanceTone = balanceSign > 0 ? "green" : balanceSign < 0 ? "red" : "muted";
    const savingsPct = Number(profitRatePercent(income, balanceValue));
    const savingsTone = savingsRateTone(savingsPct);

    return (
      <div className="grid grid-cols-2 gap-3 px-4">
        <SummaryCard
          label="รายรับรวม"
          value={formatMoney(income, currency)}
          tone="green"
          accent="rose"
        />
        <SummaryCard label="รายจ่ายรวม" value={formatMoney(expense, currency)} tone="red" />
        <SummaryCard
          label="คงเหลือ"
          value={formatMoney(balanceValue, currency)}
          tone={balanceTone}
        />
        <SummaryCard
          label="อัตราออม"
          value={`${savingsPct}%`}
          tone={savingsTone}
          progressPct={savingsPct}
        />
      </div>
    );
  }

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
          tone="green"
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
    profitSign > 0 ? "green" : profitSign < 0 ? "red" : "muted";

  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      <SummaryCard
        label="รายรับรวม"
        value={formatMoney(income, currency)}
        tone="green"
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
