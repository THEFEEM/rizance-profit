import { formatMoney, moneySign } from "@/lib/money";

/** Read-only combined profit breakdown — regular mode Stats only. */
export function CombinedProfitCard({
  regularProfit,
  boothProfit,
  combinedProfit,
  currency = "THB",
}: {
  regularProfit: string;
  boothProfit: string;
  combinedProfit: string;
  currency?: string;
}) {
  const sign = moneySign(combinedProfit);
  const totalColor =
    sign > 0 ? "text-emerald-600" : sign < 0 ? "text-red-600" : "text-slate-400";

  return (
    <div className="mt-8">
      <h2 className="px-4 text-base font-bold text-slate-900">กำไรรวม (ร้าน + บูธทั้งหมด)</h2>
      <div className="mx-4 mt-3 overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="divide-y divide-slate-100 px-4">
          <Row label="ร้านประจำ" value={formatMoney(regularProfit, currency)} />
          <Row label="บูธทั้งหมด" value={formatMoney(boothProfit, currency)} />
          <Row
            label="รวม"
            value={formatMoney(combinedProfit, currency)}
            valueClass={`text-lg font-extrabold ${totalColor}`}
            bold
          />
        </div>
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
      <span className={`text-sm ${bold ? "font-bold text-slate-900" : "text-slate-600"}`}>
        {label}
      </span>
      <span className={`tabular-nums text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
