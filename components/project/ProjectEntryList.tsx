import { projectExpenseLabel, projectFundingLabel } from "@/lib/project-categories";
import { formatDayShort } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { ProjectExpense, ProjectIncome } from "@/types/project";
import { PaymentStatusBadge } from "@/components/project/ProjectStatusBadge";

type EntryRow =
  | { kind: "income"; entry: ProjectIncome }
  | { kind: "expense"; entry: ProjectExpense };

function mergeEntries(
  incomes: ProjectIncome[],
  expenses: ProjectExpense[],
  kind: "all" | "income" | "expense",
  limit = 12,
): EntryRow[] {
  const rows: EntryRow[] = [
    ...(kind !== "expense"
      ? incomes.map((entry) => ({ kind: "income" as const, entry }))
      : []),
    ...(kind !== "income"
      ? expenses.map((entry) => ({ kind: "expense" as const, entry }))
      : []),
  ];
  rows.sort((a, b) => {
    const da = a.entry.entryDate;
    const db = b.entry.entryDate;
    if (da !== db) return db.localeCompare(da);
    return b.entry.createdAt.localeCompare(a.entry.createdAt);
  });
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export function ProjectEntryList({
  incomes,
  expenses,
  currency = "THB",
  kind = "all",
  limit,
}: {
  incomes: ProjectIncome[];
  expenses: ProjectExpense[];
  currency?: string;
  kind?: "all" | "income" | "expense";
  limit?: number;
}) {
  const rows = mergeEntries(incomes, expenses, kind, limit ?? (kind === "all" ? 12 : 0));

  if (rows.length === 0) {
    return (
      <p className="rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated/40 px-4 py-6 text-center text-sm text-rz-hint">
        ยังไม่มีรายการ
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rz-border rounded-[12px] border-[0.5px] border-rz-border bg-rz-card">
      {rows.map((row) => {
        const rejected = row.entry.paymentStatus === "rejected";
        const isIncome = row.kind === "income";
        const label = isIncome
          ? row.entry.source === "other_income" && row.entry.label
            ? row.entry.label
            : projectFundingLabel(row.entry.source)
          : projectExpenseLabel(row.entry.category);

        return (
          <li
            key={`${row.kind}-${row.entry.id}`}
            className={`px-4 py-3 ${rejected ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${rejected ? "text-rz-muted line-through" : "text-rz-text"}`}>
                  {isIncome ? "+" : "−"}
                  {formatMoney(row.entry.amount, currency)}
                </p>
                <p className="mt-0.5 truncate text-xs text-rz-hint">
                  {label}
                  {isIncome &&
                    row.entry.label &&
                    row.entry.source !== "other_income" &&
                    ` · ${row.entry.label}`}
                </p>
                <p className="mt-0.5 text-[11px] text-rz-placeholder">
                  {formatDayShort(row.entry.entryDate)}
                </p>
              </div>
              <PaymentStatusBadge status={row.entry.paymentStatus} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
