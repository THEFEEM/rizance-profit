import {
  boothCreditorsWithRepayment,
  type BoothCreditorRow,
} from "@/lib/advance-creditors";
import { listBoothAdvances } from "@/lib/booth-queries";
import { formatMoney, toCents } from "@/lib/money";
import type { SplitProfitResult } from "@/types/booth";

function BoothCreditorRow({
  row,
  currency,
}: {
  row: BoothCreditorRow;
  currency: string;
}) {
  const isPaidOff = toCents(row.remaining) <= 0;
  const paidPercent =
    toCents(row.owed) > 0
      ? Math.round((toCents(row.paid) / toCents(row.owed)) * 100)
      : isPaidOff
        ? 100
        : 0;
  const barColor = isPaidOff
    ? "bg-rz-green"
    : paidPercent === 0
      ? "bg-rz-red"
      : "bg-[#FBBF24]";
  const percentColor = isPaidOff
    ? "text-rz-green"
    : paidPercent === 0
      ? "text-rz-red"
      : "text-[#FBBF24]";

  return (
    <li className={`px-4 py-3 ${isPaidOff ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-rz-text">{row.name}</p>
            <span className="shrink-0 text-xs text-rz-muted rz-tabular">
              ติด {formatMoney(row.owed, currency)}
            </span>
          </div>
          <span className="mt-0.5 inline-block rounded-full bg-rz-elevated px-2 py-0.5 text-[10px] text-rz-muted">
            {row.isExternal ? "บุคคลภายนอก" : "สมาชิก"}
          </span>
        </div>
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-rz-elevated">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, paidPercent))}%` }}
          role="progressbar"
          aria-valuenow={paidPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className={`mt-1 text-[10px] ${percentColor}`}>{paidPercent}%</p>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="text-xs text-rz-muted">
          จ่ายแล้ว {formatMoney(row.paid, currency)} · เหลือ{" "}
          {formatMoney(row.remaining, currency)}
        </span>
        {isPaidOff && (
          <span className="shrink-0 text-xs text-rz-hint">คืนครบแล้ว</span>
        )}
      </div>
    </li>
  );
}

function GroupBlock({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: BoothCreditorRow[];
  currency: string;
}) {
  if (rows.length === 0) return null;
  const subtotalCents = rows.reduce((sum, row) => sum + toCents(row.remaining), 0);

  return (
    <div className="border-b-[0.5px] border-rz-border last:border-b-0">
      <p className="bg-rz-elevated/30 px-4 py-2 text-xs font-medium text-rz-muted">
        {title}
      </p>
      <ul className="divide-y divide-rz-border">
        {rows.map((row) => (
          <BoothCreditorRow key={`${title}-${row.name}`} row={row} currency={currency} />
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/20 px-4 py-2.5 text-sm">
        <span className="text-rz-muted">รวมเหลือ{title}</span>
        <span className="font-medium rz-tabular text-rz-red">
          {formatMoney((subtotalCents / 100).toFixed(2), currency)}
        </span>
      </div>
    </div>
  );
}

export function BoothCreditorsCard({
  rows,
  currency = "THB",
}: {
  rows: BoothCreditorRow[];
  currency?: string;
}) {
  if (rows.length === 0) return null;

  const memberRows = rows.filter((row) => !row.isExternal);
  const externalRows = rows.filter((row) => row.isExternal);
  const totalRemainingCents = rows.reduce((sum, row) => sum + toCents(row.remaining), 0);

  return (
    <section className="mt-4 px-4">
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <GroupBlock title="สมาชิก" rows={memberRows} currency={currency} />
        <GroupBlock title="บุคคลภายนอก" rows={externalRows} currency={currency} />
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
          <span className="text-rz-muted">รวมเหลือต้องคืนทั้งหมด</span>
          <span className="font-medium rz-tabular text-rz-red">
            {formatMoney((totalRemainingCents / 100).toFixed(2), currency)}
          </span>
        </div>
      </div>
    </section>
  );
}

export async function BoothCreditorsCardSection({
  userId,
  boothId,
  split,
  currency = "THB",
}: {
  userId: string;
  boothId: string;
  split: SplitProfitResult | null;
  currency?: string;
}) {
  const advances = await listBoothAdvances(userId, boothId);
  if (advances.length === 0) return null;

  const rows = boothCreditorsWithRepayment(
    advances.map((a) => ({
      creditorName: a.creditorName,
      amount: a.amount,
      isExternal: a.isExternal,
    })),
    (split?.advanceRepayments ?? []).map((r) => ({
      name: r.name,
      amount: r.amount,
    })),
  );

  return <BoothCreditorsCard rows={rows} currency={currency} />;
}
