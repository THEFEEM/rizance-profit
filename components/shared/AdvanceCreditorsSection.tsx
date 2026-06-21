import { formatMoney } from "@/lib/money";
import type { AdvanceCreditorRow } from "@/lib/advance-creditors";

/** Summary block: who paid upfront and how much is still owed back. */
export function AdvanceCreditorsSection({
  rows,
  total,
  currency = "THB",
}: {
  rows: AdvanceCreditorRow[];
  total: string;
  currency?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mt-4 px-4">
      <h2 className="mb-2 text-sm font-medium text-rz-text">เงินออกก่อน / เจ้าหนี้</h2>
      <div className="overflow-hidden rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
        <ul className="divide-y divide-rz-border">
          {rows.map((row) => (
            <li
              key={row.name}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="min-w-0 truncate text-rz-text">{row.name}</span>
              <span className="shrink-0 font-medium rz-tabular text-rz-red">
                {formatMoney(row.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-3 text-sm">
          <span className="text-rz-muted">รวมที่ต้องคืน</span>
          <span className="font-medium rz-tabular text-rz-red">
            {formatMoney(total, currency)}
          </span>
        </div>
      </div>
    </section>
  );
}
