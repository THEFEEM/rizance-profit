"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { Input } from "@/components/ui/Input";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS as CATEGORY_LABELS,
  type Expense,
  type ExpenseCategory,
} from "@/types";

export default function AddExpensePage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<Expense>("/api/expense", {
      method: "POST",
      body: JSON.stringify({
        amount: Number(raw),
        category,
        note: note.trim() || undefined,
        entryDate: date,
      }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(res.fields?.amount?.[0] ?? res.message);
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => router.back()} className="tap-target text-sm font-medium text-slate-500">
          ← Cancel
        </button>
        <h1 className="text-base font-bold text-slate-900">Add Expense</h1>
        <span className="w-16" />
      </div>

      <AmountInput value={formatTyped(raw)} tone="expense" />

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Category</p>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`tap-target rounded-full border px-4 text-sm font-medium transition-colors ${
                  category === c
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Note (optional)"
          placeholder="Milk + cups"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
        />
        <Input
          label="Date"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value || today())}
        />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>

      <div className="mt-auto px-2 pb-3">
        <QuickAmountPad value={raw} onChange={setRaw} onSave={save} saving={saving} saveLabel="SAVE" />
      </div>
    </div>
  );
}
