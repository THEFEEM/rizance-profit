"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/types";
import { DeleteConfirm } from "@/components/DeleteConfirm";

export type EntryRow = {
  id: string;
  kind: "income" | "expense";
  amount: string;
  note: string | null;
  category?: ExpenseCategory;
  createdAt: string;
};

export function EntryList({
  entries,
  currency = "THB",
  emptyHint = "No entries yet.",
}: {
  entries: EntryRow[];
  currency?: string;
  emptyHint?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<EntryRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = entries.filter((e) => !removed.has(e.id));

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(pending.id);
    setError(null);
    const res = await fetch(`/api/${pending.kind}/${pending.id}`, { method: "DELETE" });
    if (res.ok) {
      setRemoved((prev) => new Set(prev).add(pending.id));
      setPending(null);
      router.refresh();
    } else {
      setError("Could not delete that entry. Please try again.");
    }
    setDeleting(null);
  }

  if (visible.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-slate-400">{emptyHint}</p>;
  }

  return (
    <>
      {error && (
        <p className="px-4 py-2 text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {visible.map((e) => {
          const isIncome = e.kind === "income";
          const title = isIncome
            ? e.note || "Sales"
            : `${EXPENSE_CATEGORY_LABELS[e.category ?? "other"]}${e.note ? ` · ${e.note}` : ""}`;
          const displayAmount = `${isIncome ? "+ " : "− "}${formatMoney(e.amount, currency)}`;
          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl" aria-hidden>
                {isIncome ? "💰" : "🧾"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{title}</span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  isIncome ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {displayAmount}
              </span>
              <button
                onClick={() => setPending(e)}
                disabled={deleting === e.id}
                aria-label={`Delete ${title}`}
                className="tap-target -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 disabled:opacity-40"
              >
                {deleting === e.id ? "…" : "✕"}
              </button>
            </li>
          );
        })}
      </ul>

      {pending && (
        <DeleteConfirm
          title={
            pending.kind === "income"
              ? pending.note || "Sales"
              : `${EXPENSE_CATEGORY_LABELS[pending.category ?? "other"]}${pending.note ? ` · ${pending.note}` : ""}`
          }
          amount={formatMoney(pending.amount, currency)}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
          busy={deleting === pending.id}
        />
      )}
    </>
  );
}
