import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatDayShort } from "@/lib/date";
import type { Booth } from "@/types/booth";

export function BoothList({ booths, currency = "THB" }: { booths: Booth[]; currency?: string }) {
  if (booths.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-400">
        ยังไม่มีงานบูธ — กด + สร้างงานเพื่อเริ่ม Mode Even
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {booths.map((b) => (
        <li key={b.id}>
          <Link
            href={`/booth/${b.id}`}
            className="flex items-center gap-3 px-4 py-4 active:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{b.name}</p>
              <p className="text-xs text-slate-500">
                {formatDayShort(b.startDate)}
                {b.endDate !== b.startDate && ` – ${formatDayShort(b.endDate)}`}
                {" · "}
                งบ {formatMoney(b.totalBudget, currency)}
                {Number(b.memberEquity) > 0 && (
                  <span className="text-slate-400">
                    {" "}
                    (กอง {formatMoney(b.poolBudget, currency)} + สมาชิก{" "}
                    {formatMoney(b.memberEquity, currency)})
                  </span>
                )}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                b.status === "open"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {b.status === "open" ? "เปิด" : "ปิดแล้ว"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
