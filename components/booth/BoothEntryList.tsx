"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import {
  BOOTH_COST_TYPE_LABELS,
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
}: {
  kind: "income" | "expense";
  boothId: string;
  entries: BoothIncome[] | BoothExpense[];
  currency?: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows: Row[] =
    kind === "income"
      ? (entries as BoothIncome[]).map((entry) => ({ kind: "income", entry }))
      : (entries as BoothExpense[]).map((entry) => ({ kind: "expense", entry }));

  const visible = readOnly ? rows : rows.filter((r) => !removed.has(r.entry.id));

  function title(row: Row): string {
    if (row.kind === "income") {
      const e = row.entry;
      const method = PAYMENT_METHOD_LABELS[e.paymentMethod];
      return e.note ? `${method} · ${e.note}` : method;
    }
    const e = row.entry;
    const type = BOOTH_COST_TYPE_LABELS[e.costType];
    const parts = [e.label, e.note].filter(Boolean);
    return parts.length ? `${type} · ${parts.join(" · ")}` : type;
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
    return <p className="px-4 py-6 text-center text-sm text-slate-400">ยังไม่มีรายการ</p>;
  }

  const isIncome = kind === "income";

  return (
    <>
      {error && (
        <p className="px-4 py-2 text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {visible.map((row) => {
          const e = row.entry;
          const t = title(row);
          const displayAmount = `${isIncome ? "+ " : "− "}${formatMoney(e.amount, currency)}`;
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
