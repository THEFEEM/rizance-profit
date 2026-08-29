"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import {
  expenseCategoryLabel,
  expenseCostTypeLabel,
  incomeCategoryLabel,
  type ExpenseCategoryKey,
  type IncomeCategoryKey,
} from "@/lib/expense-categories";
import {
  personalExpenseLabel,
  personalIncomeLabel,
} from "@/lib/personal-categories";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ExpenseArrowIcon, IncomeArrowIcon } from "@/components/today/today-icons";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/types/booth";

export type EntryRow = {
  id: string;
  kind: "income" | "expense";
  amount: string;
  note: string | null;
  category?: ExpenseCategoryKey | IncomeCategoryKey | string;
  paymentMethod?: PaymentMethod;
  createdAt: string;
  savingsGoalName?: string;
  /** บิล POS ที่ถูกยกเลิก (soft-void) — โชว์ขีดฆ่า ไม่นับยอด ห้ามลบ/แก้ */
  voided?: boolean;
};

function entryCategoryKey(e: EntryRow): string {
  const category =
    e.category ?? (e.kind === "income" ? "storefront" : "expense_misc");
  return `${e.kind}:${category}`;
}

function entryTitle(e: EntryRow, ledger: "shop" | "personal"): string {
  const label =
    ledger === "personal"
      ? e.kind === "income"
        ? personalIncomeLabel(e.category ?? "other_income")
        : personalExpenseLabel(e.category ?? "other_expense")
      : e.kind === "income"
        ? incomeCategoryLabel(e.category ?? "storefront")
        : expenseCategoryLabel(e.category ?? "expense_misc");
  return e.note ? `${label} · ${e.note}` : label;
}

function entryCategoryLabel(e: EntryRow, ledger: "shop" | "personal"): string {
  if (ledger === "personal") {
    const base =
      e.kind === "income"
        ? personalIncomeLabel(e.category ?? "other_income")
        : personalExpenseLabel(e.category ?? "other_expense");
    return e.savingsGoalName ? `${base} · ${e.savingsGoalName}` : base;
  }
  return e.kind === "income"
    ? incomeCategoryLabel(e.category ?? "storefront")
    : expenseCategoryLabel(e.category ?? "expense_misc");
}

function entryMeta(e: EntryRow, ledger: "shop" | "personal"): string {
  const label = entryCategoryLabel(e, ledger);
  if (ledger === "personal") return label;
  const parts: string[] = [label];
  if (e.paymentMethod) {
    parts.push(PAYMENT_METHOD_LABELS[e.paymentMethod]);
  }
  if (e.kind === "expense" && ledger === "shop") {
    const typeLabel = expenseCostTypeLabel(e.category ?? "expense_misc");
    if (typeLabel) parts.push(typeLabel);
  }
  return parts.join(" · ");
}

export function EntryList({
  entries,
  currency = "THB",
  emptyHint = "No entries yet.",
  readOnly = false,
  appearance = "default",
  ledger = "shop",
}: {
  entries: EntryRow[];
  currency?: string;
  emptyHint?: string;
  /** Hide delete actions (e.g. Stats close-out view). */
  readOnly?: boolean;
  /** Dark Today list styling — does not affect Stats. */
  appearance?: "default" | "today";
  /** Shop vs personal API paths and category labels. */
  ledger?: "shop" | "personal";
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<EntryRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = readOnly ? entries : entries.filter((e) => !removed.has(e.id));
  const isToday = appearance === "today";

  function signedAmount(row: EntryRow): string {
    const sign = row.kind === "income" ? "+ " : "− ";
    return `${sign}${formatMoney(row.amount, currency)}`;
  }

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(pending.id);
    setError(null);
    const base = ledger === "personal" ? "/api/personal" : "/api";
    const res = await fetch(`${base}/${pending.kind}/${pending.id}`, { method: "DELETE" });
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
    const emptyClass = isToday
      ? "px-4 py-6 text-center text-[13px] text-rz-hint"
      : "px-4 py-6 text-center text-sm text-slate-400";
    return <p className={emptyClass}>{emptyHint}</p>;
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
        {visible.map((e) => {
          const isIncome = e.kind === "income";
          const title = entryTitle(e, ledger);
          const categoryLabel = entryMeta(e, ledger);
          const displayAmount = `${isIncome ? "+ " : "− "}${formatMoney(e.amount, currency)}`;

          if (isToday) {
            return (
              <li
                key={e.id}
                data-cat-group={entryCategoryKey(e)}
                className={`flex items-center gap-3 px-4 py-3 ${e.voided ? "opacity-55" : ""}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    e.voided
                      ? "bg-rz-hint/15 text-rz-hint"
                      : isIncome
                        ? "bg-rz-green/15 text-rz-green"
                        : "bg-rz-red/15 text-rz-red"
                  }`}
                >
                  {isIncome ? <IncomeArrowIcon /> : <ExpenseArrowIcon />}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[13px] ${
                      e.voided ? "text-rz-hint line-through" : "text-rz-text"
                    }`}
                  >
                    {title}
                  </p>
                  <p className="text-[10px] text-rz-hint">
                    {e.voided ? "ยกเลิกบิลแล้ว — ไม่นับในยอด" : categoryLabel}
                  </p>
                </div>
                <span
                  className={`rz-tabular shrink-0 text-[13px] font-medium ${
                    e.voided
                      ? "text-rz-hint line-through"
                      : isIncome
                        ? "text-rz-green"
                        : "text-rz-red"
                  }`}
                >
                  {displayAmount}
                </span>
                {e.voided ? (
                  <span className="shrink-0 rounded-md bg-rz-red/15 px-1.5 py-0.5 text-[10px] font-medium text-rz-red">
                    ยกเลิก
                  </span>
                ) : null}
                {!readOnly && !e.voided && (
                  <button
                    onClick={() => setPending(e)}
                    disabled={deleting === e.id}
                    aria-label={`Delete ${title}`}
                    className="tap-target -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-rz-hint active:bg-rz-elevated disabled:opacity-40"
                  >
                    {deleting === e.id ? "…" : "✕"}
                  </button>
                )}
              </li>
            );
          }

          return (
            <li
              key={e.id}
              data-cat-group={entryCategoryKey(e)}
              className={`flex items-center gap-3 px-4 py-3 ${e.voided ? "opacity-55" : ""}`}
            >
              <span className="text-xl" aria-hidden>
                {e.voided ? "🚫" : isIncome ? "💰" : "🧾"}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  e.voided ? "text-slate-400 line-through" : "text-slate-700"
                }`}
              >
                {title}
                {e.voided ? " · ยกเลิกบิลแล้ว" : ""}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  e.voided
                    ? "text-slate-400 line-through"
                    : isIncome
                      ? "text-emerald-600"
                      : "text-red-600"
                }`}
              >
                {displayAmount}
              </span>
              {!readOnly && !e.voided && (
                <button
                  onClick={() => setPending(e)}
                  disabled={deleting === e.id}
                  aria-label={`Delete ${title}`}
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
          title={entryTitle(pending, ledger)}
          amount={signedAmount(pending)}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
          busy={deleting === pending.id}
        />
      )}
    </>
  );
}
