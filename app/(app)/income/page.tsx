"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { EntryField } from "@/components/entry/EntryField";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { INCOME_CATEGORY_OPTIONS, type Income, type LegacyIncomeFormKey } from "@/types";

export default function AddIncomePage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState<LegacyIncomeFormKey>("storefront");
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
      <EntryPageHeader title="Add Income" />

      <EntryContextBanner target="regular" />

      <AmountInput value={formatTyped(raw)} tone="income" />

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายรับ</p>
          <CategoryGrid
            options={INCOME_CATEGORY_OPTIONS}
            value={category}
            onChange={setCategory}
            columns={3}
            accent="green"
          />
        </div>

        <EntryField
          label="Note (optional)"
          placeholder="Morning sales"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
          accent="green"
        />
        <EntryField
          label="Date"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value || today())}
          accent="green"
        />
        {error && (
          <p className="text-sm text-rz-red" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-auto px-2 pb-3">
        <QuickAmountPad
          value={raw}
          onChange={setRaw}
          onSave={save}
          saving={saving}
          accent="green"
        />
      </div>
    </div>
  );
}
