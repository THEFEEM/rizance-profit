import Link from "next/link";
import { formatDayShort } from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import type { Booth } from "@/types/booth";

export type ClosedBoothListItem = {
  booth: Booth;
  totalIncome: string;
  totalExpense: string;
  profit: string;
};

export function BoothList({
  openBooths,
  closedBooths,
  currency = "THB",
}: {
  openBooths: Booth[];
  closedBooths: ClosedBoothListItem[];
  currency?: string;
}) {
  if (openBooths.length === 0 && closedBooths.length === 0) {
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
    <div className="space-y-6">
      {openBooths.length > 0 && (
        <section>
          <SectionHeader
            label="เปิดอยู่"
            count={openBooths.length}
            dotClass="bg-rz-green"
          />
          <ul className="mt-2.5 space-y-2.5">
            {openBooths.map((b) => (
              <li key={b.id}>
                <OpenBoothCard booth={b} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {closedBooths.length > 0 && (
        <section>
          <SectionHeader
            label="ปิดแล้ว"
            count={closedBooths.length}
            dotClass="bg-rz-muted"
          />
          <ul className="mt-2.5 space-y-2.5">
            {closedBooths.map((item) => (
              <li key={item.booth.id}>
                <ClosedBoothCard item={item} currency={currency} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  label,
  count,
  dotClass,
}: {
  label: string;
  count: number;
  dotClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <h2 className="text-sm font-medium text-rz-muted">
        {label} ({count} งาน)
      </h2>
    </div>
  );
}

function OpenBoothCard({ booth, currency }: { booth: Booth; currency: string }) {
  return (
    <Link
      href={`/booth/${booth.id}`}
      className="tap-target flex items-center gap-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-rz-text">{booth.name}</p>
        <p className="mt-0.5 text-xs text-rz-hint">
          {formatDayShort(booth.startDate)}
          {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
          {" · "}
          งบ {formatMoney(booth.totalBudget, currency)}
          {Number(booth.memberEquity) > 0 && (
            <span className="text-rz-placeholder">
              {" "}
              (กอง {formatMoney(booth.poolBudget, currency)} + สมาชิก{" "}
              {formatMoney(booth.memberEquity, currency)})
            </span>
          )}
        </p>
      </div>
      <span className="shrink-0 rounded-full border-[0.5px] border-rz-logo-border bg-rz-logo-bg px-2.5 py-0.5 text-xs font-medium text-rz-green">
        เปิดอยู่
      </span>
    </Link>
  );
}

function ClosedBoothCard({
  item,
  currency,
}: {
  item: ClosedBoothListItem;
  currency: string;
}) {
  const { booth, totalIncome, totalExpense, profit } = item;
  const profitSign = moneySign(profit);
  const profitColor =
    profitSign > 0 ? "text-rz-green" : profitSign < 0 ? "text-rz-red" : "text-rz-hint";
  const profitLabel = profitSign < 0 ? "ขาดทุน" : "กำไร";

  return (
    <div className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-rz-text">{booth.name}</p>
          <p className="mt-0.5 text-xs text-rz-hint">
            {formatDayShort(booth.startDate)}
            {booth.endDate !== booth.startDate && ` – ${formatDayShort(booth.endDate)}`}
          </p>
        </div>
        <span className="shrink-0 rounded-full border-[0.5px] border-rz-border bg-rz-elevated px-2.5 py-0.5 text-xs font-medium text-rz-muted">
          ปิดแล้ว
        </span>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-rz-hint">
        <span className="text-rz-green">รายรับรวม {formatMoney(totalIncome, currency)}</span>
        {" / "}
        <span className="text-rz-red">รายจ่ายรวม {formatMoney(totalExpense, currency)}</span>
        {" / "}
        <span className={profitColor}>
          {profitLabel} {formatMoney(profit, currency)}
        </span>
      </p>

      <Link
        href={`/booth/${booth.id}/summary`}
        className="tap-target mt-2.5 inline-block text-xs font-medium text-rz-amber active:opacity-90"
      >
        ดูสรุปเต็ม →
      </Link>
    </div>
  );
}
