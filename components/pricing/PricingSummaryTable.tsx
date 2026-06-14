import Link from "next/link";
import { BreakEvenRowCard } from "@/components/pricing/BreakEvenDisplay";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, type PricingSummary } from "@/types/pricing";

function profitTone(amount: string): string {
  return Number(amount) < 0 ? "text-rz-red" : "text-rz-green";
}

export function PricingSummaryTable({ summary }: { summary: PricingSummary }) {
  const { settings, monthlyOverheadTotal, overheadPerCup, breakEvenNeedsSetup, rows } = summary;

  return (
    <div className="px-4 pb-8">
      <div className="mb-4 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-4 text-sm text-rz-muted">
        <p>
          ค่าใช้จ่ายร้านรวม/เดือน:{" "}
          <span className="rz-tabular font-medium text-rz-text">
            {formatMoney(monthlyOverheadTotal)}
          </span>
        </p>
        <p className="mt-1">
          แก้ว/เดือน (ประมาณ):{" "}
          <span className="rz-tabular font-medium text-rz-text">
            {settings.estimatedCupsPerMonth.toLocaleString()}
          </span>
          {settings.estimatedCupsPerMonth === 0 && (
            <Link href="/pricing/overheads" className="ml-2 font-medium text-rz-green">
              ตั้งค่า →
            </Link>
          )}
        </p>
        <p className="mt-1">
          {PRICING_LABELS.overheadPerCup}:{" "}
          <span className="rz-tabular font-medium text-rz-text">
            {overheadPerCup ? formatMoney(overheadPerCup) : "—"}
          </span>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-rz-hint">
          ยังไม่มีเมนู —{" "}
          <Link href="/pricing/recipes" className="font-medium text-rz-green">
            เพิ่มสูตรเครื่องดื่ม
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
          <table className="w-full min-w-[640px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b-[0.5px] border-rz-border text-rz-hint">
                <th className="px-3 py-3 font-medium">{PRICING_LABELS.menu}</th>
                <th className="px-2 py-3 font-medium">{PRICING_LABELS.ingredientCost}</th>
                <th className="px-2 py-3 font-medium">{PRICING_LABELS.overheadPerCup}</th>
                <th className="px-2 py-3 font-medium">{PRICING_LABELS.totalCost}</th>
                <th className="px-2 py-3 font-medium">{PRICING_LABELS.desiredProfit}</th>
                <th className="px-2 py-3 font-medium text-rz-text">{PRICING_LABELS.sellingPrice}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.menuItemId} className="border-b-[0.5px] border-rz-border last:border-b-0">
                  <td className="px-3 py-3 font-medium text-rz-text">{r.menuName}</td>
                  <td className="rz-tabular px-2 py-3 text-rz-muted">
                    {formatMoney(r.ingredientCostPerCup)}
                  </td>
                  <td className="rz-tabular px-2 py-3 text-rz-muted">
                    {r.overheadPerCup ? formatMoney(r.overheadPerCup) : "—"}
                  </td>
                  <td className="rz-tabular px-2 py-3 text-rz-muted">
                    {formatMoney(r.totalCostPerCup)}
                  </td>
                  <td className={`rz-tabular px-2 py-3 font-medium ${profitTone(r.profitPerCup)}`}>
                    {formatMoney(r.profitPerCup)}
                  </td>
                  <td className="rz-tabular px-2 py-3 text-base font-medium text-rz-green">
                    {r.sellingPriceDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t-[0.5px] border-rz-border px-3 py-2 text-xs text-rz-hint">
            ราคาขายปัดเป็นจำนวนเต็มบาท (แสดงผลเท่านั้น) · คำนวณภายในใช้ทศนิยม 2 ตำแหน่ง
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-medium text-rz-text">{PRICING_LABELS.breakEven}</h2>
          <div className="grid gap-3">
            {rows.map((r) => (
              <BreakEvenRowCard
                key={r.menuItemId}
                row={r.breakEven}
                estimatedCupsPerMonth={settings.estimatedCupsPerMonth}
                needsSetup={breakEvenNeedsSetup}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
