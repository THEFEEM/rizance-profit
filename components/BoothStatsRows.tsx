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
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  return (
    <div className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="divide-y divide-slate-100 px-4">
        <Row label="รายรับเงินสด" value={formatMoney(cashIncome, currency)} />
        <Row label="รายรับโอน" value={formatMoney(transferIncome, currency)} />
        <Row label="รายรับรวม" value={formatMoney(totalIncome, currency)} bold />
        <Row label="ค่าใช้จ่ายคงที่" value={formatMoney(fixedExpense, currency)} />
        <Row label="ค่าใช้จ่ายผันแปร" value={formatMoney(variableExpense, currency)} />
        <Row label="ค่าใช้จ่ายรวม" value={formatMoney(totalExpense, currency)} bold />
        <Row
          label="กำไร/ขาดทุน"
          value={formatMoney(profit, currency)}
          valueClass={`text-lg font-extrabold ${profitColor}`}
          bold
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "text-slate-900",
  bold = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <span className={`text-sm ${bold ? "font-semibold text-slate-800" : "text-slate-500"}`}>
        {label}
      </span>
      <span className={`tabular-nums text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
