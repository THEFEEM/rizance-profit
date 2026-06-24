import { formatMoney } from "@/lib/money";
import {
  advanceCreditorsByKind,
  advanceCreditorsTotal,
  type AdvanceCreditorRow,
} from "@/lib/advance-creditors";
import type { PayerKind } from "@/types";

const KIND_LABELS: Record<PayerKind, string> = {
  member: "สมาชิก",
  external: "บุคคลภายนอก",
};

function CreditorList({
  rows,
  currency,
}: {
  rows: AdvanceCreditorRow[];
  currency: string;
}) {
  if (rows.length === 0) return null;

  return (
    <ul className="divide-y divide-rz-border">
      {rows.map((row) => (
        <li
          key={`${row.payerKind ?? "external"}-${row.name}`}
          className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <span className="block truncate text-rz-text">{row.name}</span>
            {row.count != null && row.count > 0 && (
              <span className="text-xs text-rz-hint">{row.count} รายการ</span>
            )}
          </div>
          <span className="shrink-0 font-medium rz-tabular text-rz-red">
            {formatMoney(row.amount, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroupBlock({
  kind,
  rows,
  currency,
}: {
  kind: PayerKind;
  rows: AdvanceCreditorRow[];
  currency: string;
}) {
  if (rows.length === 0) return null;
  const subtotal = advanceCreditorsTotal(rows);

  return (
    <div className="border-b-[0.5px] border-rz-border last:border-b-0">
      <p className="bg-rz-elevated/30 px-4 py-2 text-xs font-medium text-rz-muted">
        {KIND_LABELS[kind]}
      </p>
      <CreditorList rows={rows} currency={currency} />
      <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/20 px-4 py-2.5 text-sm">
        <span className="text-rz-muted">รวม{KIND_LABELS[kind]}</span>
        <span className="font-medium rz-tabular text-rz-red">
          {formatMoney(subtotal, currency)}
        </span>
      </div>
    </div>
  );
}

/** Summary block: who paid upfront and how much is still owed back. */
export function AdvanceCreditorsSection({
  rows,
  total,
  currency = "THB",
  title = "เงินออกก่อน / เจ้าหนี้",
}: {
  rows: AdvanceCreditorRow[];
  total: string;
  currency?: string;
  title?: string;
}) {
  if (rows.length === 0) return null;

  const isGrouped = rows.some((r) => r.payerKind != null);
  const memberRows = advanceCreditorsByKind(rows, "member");
  const externalRows = advanceCreditorsByKind(rows, "external");

  return (
    <section className="mt-4 px-4">
      {title ? <h2 className="mb-2 text-sm font-medium text-rz-text">{title}</h2> : null}
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        {isGrouped ? (
          <>
            <GroupBlock kind="member" rows={memberRows} currency={currency} />
            <GroupBlock kind="external" rows={externalRows} currency={currency} />
          </>
        ) : (
          <CreditorList rows={rows} currency={currency} />
        )}
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
          <span className="text-rz-muted">
            {isGrouped ? "รวมที่ต้องคืนทั้งหมด" : "รวมที่ต้องคืน"}
          </span>
          <span className="font-medium rz-tabular text-rz-red">
            {formatMoney(total, currency)}
          </span>
        </div>
      </div>
    </section>
  );
}
