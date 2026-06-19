import { projectExpenseLabel, projectFundingLabel } from "@/lib/project-categories";
import { formatDayShort } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { ProjectExpense, ProjectIncome } from "@/types/project";

type Row =
  | { kind: "income"; entry: ProjectIncome }
  | { kind: "expense"; entry: ProjectExpense };

function mergeRows(
  incomes: ProjectIncome[],
  expenses: ProjectExpense[],
  kind: "income" | "expense" | "all",
  limit = 20,
): Row[] {
  const rows: Row[] =
    kind === "all"
      ? [
          ...incomes.map((entry) => ({ kind: "income" as const, entry })),
          ...expenses.map((entry) => ({ kind: "expense" as const, entry })),
        ]
      : kind === "income"
        ? incomes.map((entry) => ({ kind: "income" as const, entry }))
        : expenses.map((entry) => ({ kind: "expense" as const, entry }));
  rows.sort((a, b) => {
    const da = a.entry.entryDate;
    const db = b.entry.entryDate;
    if (da !== db) return db.localeCompare(da);
    return b.entry.createdAt.localeCompare(a.entry.createdAt);
  });
  return rows.slice(0, limit);
}

export function OrgProjectEntryList({
  incomes,
  expenses,
  activityNames,
  generalActivityId,
  currency = "THB",
  kind,
  limit = 20,
}: {
  incomes: ProjectIncome[];
  expenses: ProjectExpense[];
  activityNames: Record<string, string>;
  generalActivityId: string;
  currency?: string;
  kind: "income" | "expense" | "all";
  limit?: number;
}) {
  const rows = mergeRows(incomes, expenses, kind, limit);

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
        const isIncome = row.kind === "income";
        const activityName =
          activityNames[row.entry.activityId] ??
          (row.entry.activityId === generalActivityId ? "กองกลาง" : "—");
        const categoryLabel = isIncome
          ? row.entry.source === "other_income" && row.entry.label
            ? row.entry.label
            : projectFundingLabel(row.entry.source)
          : projectExpenseLabel(row.entry.category);

        const tags: string[] = [activityName];
        if (!isIncome) {
          const exp = row.entry;
          if (exp.fundSource) {
            tags.push(projectFundingLabel(exp.fundSource));
          } else {
            tags.push("กองกลาง");
          }
        }

        return (
          <li key={`${row.kind}-${row.entry.id}`} className="px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-rz-text">
                {isIncome ? "+" : "−"}
                {formatMoney(row.entry.amount, currency)}
              </p>
              <p className="mt-0.5 truncate text-xs text-rz-hint">{categoryLabel}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border-[0.5px] border-rz-border bg-rz-elevated px-2 py-0.5 text-[10px] text-rz-muted"
                  >
                    {tag}
                  </span>
                ))}
                {!isIncome && row.entry.isAdvance && (
                  <span className="rounded-full border-[0.5px] border-[#5A3F12] bg-[#2E2310] px-2 py-0.5 text-[10px] text-rz-amber">
                    สำรองจ่าย
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-rz-placeholder">
                {formatDayShort(row.entry.entryDate)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
