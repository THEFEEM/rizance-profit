"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import { CategoryGrid } from "@/components/CategoryGrid";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import {
  INCOME_CATEGORY_GRID_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type Income,
  type IncomeCategoryKey,
  type PaymentMethod,
} from "@/types";

export function RegularIncomeEntry() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState<IncomeCategoryKey>("storefront");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
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
        paymentMethod,
        note: note.trim() || undefined,
        entryDate: date,
      }),
    });
    if (res.ok) {
      router.push("/home");
      router.refresh();
    } else {
      setError(res.fields?.amount?.[0] ?? res.message);
      setSaving(false);
    }
  }

  return (
    <EntryFormLayout
      pad={
        <AmountPadSection
          raw={raw}
          onChange={setRaw}
          onSave={save}
          saving={saving}
          tone="income"
          accent="green"
        />
      }
    >
      <EntryPageHeader title="Add Income" />
      <EntryContextBanner target="regular" />

      <div className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายรับ</p>
          <CategoryGrid
            options={INCOME_CATEGORY_GRID_OPTIONS}
            value={category}
            onChange={setCategory}
            columns={3}
            accent="green"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ช่องทางรับเงิน</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <EntryOptionButton
                key={m}
                selected={paymentMethod === m}
                onClick={() => setPaymentMethod(m)}
                accent="green"
              >
                {PAYMENT_METHOD_LABELS[m]}
              </EntryOptionButton>
            ))}
          </div>
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
    </EntryFormLayout>
  );
}
