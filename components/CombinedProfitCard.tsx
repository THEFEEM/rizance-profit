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
    sign > 0 ? "text-rz-green" : sign < 0 ? "text-rz-red" : "text-rz-hint";

  return (
    <div className="mt-8">
      <h2 className="px-4 text-base font-medium text-rz-text">กำไรรวม (ร้าน + บูธทั้งหมด)</h2>
      <div className="mx-4 mt-3 overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <div className="divide-y divide-rz-border px-4">
          <Row label="ร้านประจำ" value={formatMoney(regularProfit, currency)} />
          <Row label="บูธทั้งหมด" value={formatMoney(boothProfit, currency)} />
          <Row
            label="รวม"
            value={formatMoney(combinedProfit, currency)}
            valueClass={`text-lg font-medium ${totalColor}`}
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
  valueClass = "text-rz-text",
  bold = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3.5">
      <span className={`text-sm ${bold ? "font-medium text-rz-text" : "text-rz-muted"}`}>
        {label}
      </span>
      <span className={`rz-tabular text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
