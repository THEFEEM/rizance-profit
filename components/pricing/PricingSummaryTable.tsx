import Link from "next/link";
import { BreakEvenRowCard } from "@/components/pricing/BreakEvenDisplay";
import { formatMoney } from "@/lib/money";
import { PRICING_LABELS, type PricingSummary } from "@/types/pricing";

export function PricingSummaryTable({ summary }: { summary: PricingSummary }) {
  const { settings, monthlyOverheadTotal, overheadPerCup, breakEvenNeedsSetup, rows } = summary;

  return (
    <div className="px-4 pb-8">
      <div className="mb-4 rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
        <p>
          ค่าใช้จ่ายร้านรวม/เดือน:{" "}
          <span className="font-semibold">{formatMoney(monthlyOverheadTotal)}</span>
        </p>
        <p>
          แก้ว/เดือน (ประมาณ):{" "}
          <span className="font-semibold">{settings.estimatedCupsPerMonth.toLocaleString()}</span>
          {settings.estimatedCupsPerMonth === 0 && (
            <Link href="/pricing/overheads" className="ml-2 text-emerald-700">
              ตั้งค่า →
            </Link>
          )}
        </p>
        <p>
          {PRICING_LABELS.overheadPerCup}:{" "}
          <span className="font-semibold">
            {overheadPerCup ? formatMoney(overheadPerCup) : "—"}
          </span>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          ยังไม่มีเมนู —{" "}
          <Link href="/pricing/recipes" className="text-emerald-700">
            เพิ่มสูตรเครื่องดื่ม
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500">
                <th className="px-3 py-3">{PRICING_LABELS.menu}</th>
                <th className="px-2 py-3">{PRICING_LABELS.ingredientCost}</th>
                <th className="px-2 py-3">{PRICING_LABELS.overheadPerCup}</th>
                <th className="px-2 py-3">{PRICING_LABELS.totalCost}</th>
                <th className="px-2 py-3">{PRICING_LABELS.desiredProfit}</th>
                <th className="px-2 py-3 font-bold text-slate-800">{PRICING_LABELS.sellingPrice}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.menuItemId} className="border-b border-slate-50">
                  <td className="px-3 py-3 font-medium text-slate-900">{r.menuName}</td>
                  <td className="px-2 py-3 tabular-nums">{formatMoney(r.ingredientCostPerCup)}</td>
                  <td className="px-2 py-3 tabular-nums">
                    {r.overheadPerCup ? formatMoney(r.overheadPerCup) : "—"}
                  </td>
                  <td className="px-2 py-3 tabular-nums">{formatMoney(r.totalCostPerCup)}</td>
                  <td className="px-2 py-3 tabular-nums text-emerald-700">
                    {formatMoney(r.profitPerCup)}
                  </td>
                  <td className="px-2 py-3 text-base font-extrabold tabular-nums text-emerald-700">
                    {r.sellingPriceDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-400">
            ราคาขายปัดเป็นจำนวนเต็มบาท (แสดงผลเท่านั้น) · คำนวณภายในใช้ทศนิยม 2 ตำแหน่ง
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-bold text-slate-900">{PRICING_LABELS.breakEven}</h2>
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
