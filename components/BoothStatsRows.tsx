import { formatMoney, moneySign, sumDecimals } from "@/lib/money";

/** Booth P&L breakdown for Stats — cash/transfer income, fixed/variable expense. */
export function BoothStatsRows({
  cashIncome,
  transferIncome,
  fixedExpense,
  variableExpense,
  profit,
  currency = "THB",
}: {
  cashIncome: string;
  transferIncome: string;
  fixedExpense: string;
  variableExpense: string;
  profit: string;
  currency?: string;
}) {
  const totalIncome = sumDecimals(cashIncome, transferIncome);
  const totalExpense = sumDecimals(fixedExpense, variableExpense);
  const sign = moneySign(profit);
  const profitColor =
    sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";

  return (
    <div className="mx-4 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <div className="divide-y divide-rz-border px-4">
        <Row label="รายรับเงินสด" value={formatMoney(cashIncome, currency)} />
        <Row label="รายรับโอน" value={formatMoney(transferIncome, currency)} />
        <Row label="รายรับรวม" value={formatMoney(totalIncome, currency)} bold accent />
        <Row label="ค่าใช้จ่ายคงที่" value={formatMoney(fixedExpense, currency)} />
        <Row label="ค่าใช้จ่ายผันแปร" value={formatMoney(variableExpense, currency)} />
        <Row label="ค่าใช้จ่ายรวม" value={formatMoney(totalExpense, currency)} bold accent />
        <Row
          label="กำไร/ขาดทุน"
          value={formatMoney(profit, currency)}
          valueClass={`text-lg font-medium ${profitColor}`}
          bold
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "text-rz-text",
  bold = false,
  accent = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <span
        className={`text-sm ${
          bold
            ? accent
              ? "font-medium text-rz-amber"
              : "font-medium text-rz-text"
            : "text-rz-muted"
        }`}
      >
        {label}
      </span>
      <span className={`rz-tabular text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
