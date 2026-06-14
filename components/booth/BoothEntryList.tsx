"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { formatDayShort } from "@/lib/date";
import { expenseCategoryLabel, expenseCostTypeLabel, incomeCategoryLabel } from "@/lib/expense-categories";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ExpenseArrowIcon, IncomeArrowIcon } from "@/components/today/today-icons";
import {
  PAYMENT_METHOD_LABELS,
  type BoothExpense,
  type BoothIncome,
} from "@/types/booth";

type IncomeRow = { kind: "income"; entry: BoothIncome };
type ExpenseRow = { kind: "expense"; entry: BoothExpense };
type Row = IncomeRow | ExpenseRow;

export function BoothEntryList({
  kind,
  boothId,
  entries,
  currency = "THB",
  readOnly = false,
  appearance = "default",
}: {
  kind: "income" | "expense";
  boothId: string;
  entries: BoothIncome[] | BoothExpense[];
  currency?: string;
  readOnly?: boolean;
  appearance?: "default" | "entry";
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isToday = appearance === "entry";
  const isIncome = kind === "income";

  const rows: Row[] =
    kind === "income"
      ? (entries as BoothIncome[]).map((entry) => ({ kind: "income", entry }))
      : (entries as BoothExpense[]).map((entry) => ({ kind: "expense", entry }));

  const visible = readOnly ? rows : rows.filter((r) => !removed.has(r.entry.id));

  function title(row: Row): string {
    if (row.kind === "income") {
      const e = row.entry;
      const cat = incomeCategoryLabel(e.category);
      return e.note ? `${cat} · ${e.note}` : cat;
    }
    const e = row.entry;
    const cat = expenseCategoryLabel(e.category);
    const parts = [e.label, e.note].filter(Boolean);
    return parts.length ? `${cat} · ${parts.join(" · ")}` : cat;
  }

  function meta(row: Row): string {
    const date = formatDayShort(row.entry.entryDate);
    if (row.kind === "income") {
      return `${date} · ${PAYMENT_METHOD_LABELS[row.entry.paymentMethod]}`;
    }
    const badge = expenseCostTypeLabel(row.entry.category);
    return badge ? `${date} · ${badge}` : date;
  }

  async function confirmDelete() {
    if (!pending || deleting) return;
    const id = pending.entry.id;
    setDeleting(id);
    setError(null);
    const path =
      pending.kind === "income"
        ? `/api/booths/${boothId}/income/${id}`
        : `/api/booths/${boothId}/expense/${id}`;
    const res = await fetch(path, { method: "DELETE" });
    if (res.ok) {
      setRemoved((prev) => new Set(prev).add(id));
      setPending(null);
      router.refresh();
    } else {
      setError("ลบรายการไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
    setDeleting(null);
  }

  if (visible.length === 0) {
    const emptyClass = isToday
      ? "px-4 py-6 text-center text-[13px] text-rz-hint"
      : "px-4 py-6 text-center text-sm text-slate-400";
    return <p className={emptyClass}>ยังไม่มีรายการ</p>;
  }

  const dividerClass = isToday ? "divide-rz-border" : "divide-slate-100";
  const errorClass = isToday
    ? "px-4 py-2 text-center text-sm text-rz-red"
    : "px-4 py-2 text-center text-sm text-red-600";

  return (
    <>
      {error && (
        <p className={errorClass} role="alert">
          {error}
        </p>
      )}
      <ul className={`divide-y ${dividerClass}`}>
        {visible.map((row) => {
          const e = row.entry;
          const t = title(row);
          const displayAmount = `${isIncome ? "+ " : "− "}${formatMoney(e.amount, currency)}`;

          if (isToday) {
            return (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isIncome ? "bg-rz-green/15 text-rz-green" : "bg-rz-red/15 text-rz-red"
                  }`}
                >
                  {isIncome ? <IncomeArrowIcon /> : <ExpenseArrowIcon />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-rz-text">{t}</p>
                  <p className="text-[10px] text-rz-hint">{meta(row)}</p>
                </div>
                <span
                  className={`rz-tabular shrink-0 text-[13px] font-medium ${
                    isIncome ? "text-rz-green" : "text-rz-red"
                  }`}
                >
                  {displayAmount}
                </span>
                {!readOnly && (
                  <button
                    onClick={() => setPending(row)}
                    disabled={deleting === e.id}
                    aria-label={`ลบ ${t}`}
                    className="tap-target -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated disabled:opacity-40"
                  >
                    {deleting === e.id ? "…" : "✕"}
                  </button>
                )}
              </li>
            );
          }

          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl" aria-hidden>
                {isIncome ? "💰" : "🧾"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-700">{t}</p>
                <p className="text-xs text-slate-400">{e.entryDate}</p>
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  isIncome ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {displayAmount}
              </span>
              {!readOnly && (
                <button
                  onClick={() => setPending(row)}
                  disabled={deleting === e.id}
                  aria-label={`ลบ ${t}`}
                  className="tap-target -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 disabled:opacity-40"
                >
                  {deleting === e.id ? "…" : "✕"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {pending && (
        <DeleteConfirm
          title={title(pending)}
          amount={formatMoney(pending.entry.amount, currency)}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
          busy={deleting === pending.entry.id}
        />
      )}
    </>
  );
}
