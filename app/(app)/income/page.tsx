"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { Input } from "@/components/ui/Input";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import type { Income } from "@/types";

export default function AddIncomePage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<Income>("/api/income", {
      method: "POST",
      body: JSON.stringify({
        amount: Number(raw),
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
        <h1 className="text-base font-bold text-slate-900">Add Income</h1>
        <span className="w-16" />
      </div>

      <AmountInput value={formatTyped(raw)} tone="income" />

      <div className="flex flex-col gap-3 px-4">
        <Input
          label="Note (optional)"
          placeholder="Morning sales"
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
        <QuickAmountPad value={raw} onChange={setRaw} onSave={save} saving={saving} />
      </div>
    </div>
  );
}
