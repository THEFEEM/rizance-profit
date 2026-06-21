import { formatMoney } from "@/lib/money";
import type { BreakdownRow } from "@/lib/project-breakdown";
import { ProjectIconBox } from "@/components/project/icons";

function BreakdownList({
  rows,
  currency,
  amountClass,
}: {
  rows: BreakdownRow[];
  currency: string;
  amountClass: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-5 text-center text-sm text-rz-hint">
        ยังไม่มีรายการ
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rz-border rounded-[12px] border-[0.5px] border-rz-border bg-rz-card">
      {rows.map((row) => (
        <li key={`${row.key}-${row.label}`} className="flex items-center gap-3 px-4 py-3">
          <ProjectIconBox
            name={row.icon}
            color={row.color}
            bg={row.bg ?? `${row.color}22`}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-rz-text">{row.label}</p>
          </div>
          <p className={`shrink-0 text-sm font-medium rz-tabular ${amountClass}`}>
            {formatMoney(row.amount, currency)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ProjectIncomeBreakdown({
  rows,
  currency = "THB",
  title = "แหล่งเงินเข้า",
}: {
  rows: BreakdownRow[];
  currency?: string;
  title?: string;
}) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-medium text-rz-muted">{title}</h2>
      <BreakdownList rows={rows} currency={currency} amountClass="text-rz-green" />
    </section>
  );
}

export function ProjectExpenseBreakdown({
  rows,
  currency = "THB",
  title = "รายจ่ายตามหมวด",
}: {
  rows: BreakdownRow[];
  currency?: string;
  title?: string;
}) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-medium text-rz-muted">{title}</h2>
      <BreakdownList rows={rows} currency={currency} amountClass="text-rz-red" />
    </section>
  );
}
