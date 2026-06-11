"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/date";

export type CategoryBreakdownRow = {
  category: string;
  label: string;
  icon: string;
  amount: string;
  count: number;
};

export type CategoryBreakdownEntry = {
  id: string;
  entryDate: string;
  amount: string;
  note: string | null;
};

export function CategoryBreakdownPanel({
  incomeRows,
  expenseRows,
  incomeEntries,
  expenseEntries,
  currency = "THB",
}: {
  incomeRows: CategoryBreakdownRow[];
  expenseRows: CategoryBreakdownRow[];
  incomeEntries: Record<string, CategoryBreakdownEntry[]>;
  expenseEntries: Record<string, CategoryBreakdownEntry[]>;
  currency?: string;
}) {
  if (incomeRows.length === 0 && expenseRows.length === 0) return null;

  return (
    <div className="mt-6 space-y-6">
      {incomeRows.length > 0 && (
        <CategorySection
          title="รายรับตามหมวด"
          rows={incomeRows}
          entriesByCategory={incomeEntries}
          currency={currency}
          tone="income"
        />
      )}
      {expenseRows.length > 0 && (
        <CategorySection
          title="รายจ่ายตามหมวด"
          rows={expenseRows}
          entriesByCategory={expenseEntries}
          currency={currency}
          tone="expense"
        />
      )}
    </div>
  );
}

function CategorySection({
  title,
  rows,
  entriesByCategory,
  currency,
  tone,
}: {
  title: string;
  rows: CategoryBreakdownRow[];
  entriesByCategory: Record<string, CategoryBreakdownEntry[]>;
  currency: string;
  tone: "income" | "expense";
}) {
  const [open, setOpen] = useState<string | null>(null);
  const amountColor = tone === "income" ? "text-emerald-600" : "text-red-600";

  return (
    <div>
      <h2 className="px-4 pb-2 text-sm font-bold text-slate-900">{title}</h2>
      <div className="mx-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const expanded = open === row.category;
            const entries = entriesByCategory[row.category] ?? [];
            return (
              <li key={row.category}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : row.category)}
                  className="tap-target flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
                  aria-expanded={expanded}
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                    {row.label}
                  </span>
                  <span className="text-right">
                    <span className={`block text-sm font-semibold tabular-nums ${amountColor}`}>
                      {formatMoney(row.amount, currency)}
                    </span>
                    <span className="block text-xs text-slate-400">{row.count} รายการ</span>
                  </span>
                  <span className="text-slate-400" aria-hidden>
                    {expanded ? "▾" : "▸"}
                  </span>
                </button>
                {expanded && entries.length > 0 && (
                  <ul className="border-t border-slate-100 bg-slate-50/80">
                    {entries.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 pl-12 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-slate-600">
                          {formatDateLabel(e.entryDate)}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                        <span className={`shrink-0 font-semibold tabular-nums ${amountColor}`}>
                          {formatMoney(e.amount, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
