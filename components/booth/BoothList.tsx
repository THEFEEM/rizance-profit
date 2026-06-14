import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatDayShort } from "@/lib/date";
import type { Booth } from "@/types/booth";

export function BoothList({ booths, currency = "THB" }: { booths: Booth[]; currency?: string }) {
  if (booths.length === 0) {
    return (
      <div className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-10 text-center">
        <p className="text-sm text-rz-hint">ยังไม่มีงานบูธ</p>
        <p className="mt-1 text-xs text-rz-placeholder">สร้างงานแรกเพื่อเริ่มบันทึกรายรับ–รายจ่ายบูธ</p>
        <Link
          href="/booth/new"
          className="tap-target mt-4 inline-flex rounded-full border-[0.5px] border-[#5A3F12] bg-[#2E2310] px-5 py-2.5 text-sm font-medium text-rz-amber active:opacity-90"
        >
          + สร้างงานบูธ
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {booths.map((b) => (
        <li key={b.id}>
          <Link
            href={`/booth/${b.id}`}
            className="tap-target flex items-center gap-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-rz-text">{b.name}</p>
              <p className="mt-0.5 text-xs text-rz-hint">
                {formatDayShort(b.startDate)}
                {b.endDate !== b.startDate && ` – ${formatDayShort(b.endDate)}`}
                {" · "}
                งบ {formatMoney(b.totalBudget, currency)}
                {Number(b.memberEquity) > 0 && (
                  <span className="text-rz-placeholder">
                    {" "}
                    (กอง {formatMoney(b.poolBudget, currency)} + สมาชิก{" "}
                    {formatMoney(b.memberEquity, currency)})
                  </span>
                )}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                b.status === "open"
                  ? "border-[0.5px] border-rz-logo-border bg-rz-logo-bg text-rz-green"
                  : "border-[0.5px] border-rz-border bg-rz-elevated text-rz-muted"
              }`}
            >
              {b.status === "open" ? "เปิดอยู่" : "ปิดแล้ว"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
