"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatDateLabel } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { CategoryBreakdownEntry } from "@/components/stats/CategoryBreakdownPanel";

export type CategoryProgressRow = {
  category: string;
  label: string;
  icon: ReactNode;
  amount: string;
  percentage: number;
  count: number;
};

export function CategoryProgressList({
  rows,
  entriesByCategory,
  currency = "THB",
  tone = "income",
  accent = "green",
}: {
  rows: CategoryProgressRow[];
  entriesByCategory: Record<string, CategoryBreakdownEntry[]>;
  currency?: string;
  tone?: "income" | "expense";
  accent?: "green" | "amber" | "purple" | "rose";
}) {
  const [open, setOpen] = useState<string | null>(null);
  const barClass =
    tone === "expense"
      ? "bg-rz-red"
      : accent === "rose"
        ? "bg-rz-rose"
        : accent === "amber"
          ? "bg-rz-amber"
          : accent === "purple"
            ? "bg-rz-purple"
            : "bg-rz-green";
  const amountClass = tone === "expense" ? "text-rz-red" : "text-rz-green";

  if (rows.length === 0) return null;

  return (
    <ul className="divide-y divide-rz-border">
      {rows.map((row) => {
        const expanded = open === row.category;
        const entries = entriesByCategory[row.category] ?? [];
        const pct = Math.min(100, Math.max(0, row.percentage));

        return (
          <li key={row.category}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : row.category)}
              className="tap-target flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-rz-elevated"
              aria-expanded={expanded}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
                {row.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-rz-text">{row.label}</span>
                  <span className="shrink-0 text-xs text-rz-hint">{pct.toFixed(0)}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-rz-elevated">
                  <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-rz-hint">{row.count} รายการ</p>
              </div>
              <span className={`shrink-0 text-sm font-medium rz-tabular ${amountClass}`}>
                {formatMoney(row.amount, currency)}
              </span>
              <span className="text-rz-hint" aria-hidden>
                {expanded ? "▾" : "▸"}
              </span>
            </button>
            {expanded && entries.length > 0 && (
              <ul className="border-t-[0.5px] border-rz-border bg-rz-elevated/50">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 pl-12 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-rz-muted">
                      {formatDateLabel(e.entryDate)}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className={`shrink-0 font-medium rz-tabular ${amountClass}`}>
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
  );
}
