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
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "muted";
}) {
  const valueClass =
    tone === "green"
      ? "text-rz-green"
      : tone === "red"
        ? "text-rz-red"
        : "text-rz-hint";

  return (
    <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5">
      <p className="text-xs text-rz-muted">{label}</p>
      <p className={`mt-1 text-lg font-medium rz-tabular ${valueClass}`}>{value}</p>
    </div>
  );
}

export function StatsSummaryCards({
  income,
  expense,
  profit,
  currency = "THB",
}: {
  income: string;
  expense: string;
  profit: string;
  currency?: string;
}) {
  const profitSign = moneySign(profit);
  const profitTone = profitSign > 0 ? "green" : profitSign < 0 ? "red" : "muted";

  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      <SummaryCard label="รายรับรวม" value={formatMoney(income, currency)} tone="green" />
      <SummaryCard label="รายจ่ายรวม" value={formatMoney(expense, currency)} tone="red" />
      <SummaryCard label="กำไรสุทธิ" value={formatMoney(profit, currency)} tone={profitTone} />
      <SummaryCard
        label="อัตรากำไร"
        value={`${profitRatePercent(income, profit)}%`}
        tone="muted"
      />
    </div>
  );
}
