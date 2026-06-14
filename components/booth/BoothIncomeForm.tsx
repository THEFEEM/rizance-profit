"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { BoothEntryList } from "@/components/booth/BoothEntryList";
import { CategoryGrid } from "@/components/CategoryGrid";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import {
  INCOME_CATEGORY_GRID_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type IncomeCategoryKey,
  type PaymentMethod,
} from "@/types";
import { type BoothIncome } from "@/types/booth";

export function BoothIncomeForm({
  boothId,
  boothName,
  startDate,
  endDate,
  closed,
  defaultDate,
  entries,
  currency = "THB",
}: {
  boothId: string;
  boothName: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  defaultDate: string;
  entries: BoothIncome[];
  currency?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState<IncomeCategoryKey>("storefront");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = (d: string) => clampDateToRange(d, startDate, endDate);

  async function save() {
    if (closed) return;
    setSaving(true);
    setError(null);
    const res = await apiFetch<BoothIncome>(`/api/booths/${boothId}/income`, {
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
      setRaw("");
      setNote("");
      router.refresh();
    } else {
      setError(res.fields?.amount?.[0] ?? res.message);
    }
    setSaving(false);
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <BoothBack href={`/booth/${boothId}`} />
        <h1 className="text-base font-medium text-rz-text">รายรับบูธ</h1>
        <span className="w-16" aria-hidden />
      </div>
      <EntryContextBanner target="booth" name={boothName} />

      {closed && (
        <div className="mb-3">
          <BoothClosedBanner />
        </div>
      )}

      <AmountInput value={formatTyped(raw)} tone="income" />

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายรับ</p>
          <CategoryGrid
            options={INCOME_CATEGORY_GRID_OPTIONS}
            value={category}
            onChange={setCategory}
            columns={3}
            accent="amber"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ช่องทางรับเงิน</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <EntryOptionButton
                key={m}
                selected={paymentMethod === m}
                disabled={closed}
                onClick={() => setPaymentMethod(m)}
                accent="amber"
              >
                {PAYMENT_METHOD_LABELS[m]}
              </EntryOptionButton>
            ))}
          </div>
        </div>

        <EntryField
          label="หมายเหตุ (ไม่บังคับ)"
          placeholder="ยอดขายเช้า"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
          disabled={closed}
          accent="amber"
        />
        <EntryField
          label="วันที่"
          type="date"
          value={date}
          min={startDate}
          max={endDate}
          disabled={closed}
          onChange={(e) => setDate(clamp(e.target.value || defaultDate))}
          accent="amber"
        />
        {error && (
          <p className="text-sm text-rz-red" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-auto px-2 pb-3">
        {closed ? (
          <p className="px-2 py-4 text-center text-sm text-rz-hint">ฟอร์มถูกปิดใช้งาน</p>
        ) : (
          <QuickAmountPad
            value={raw}
            onChange={setRaw}
            onSave={save}
            saving={saving}
            saveLabel="บันทึก"
            accent="amber"
          />
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการที่บันทึกแล้ว</h2>
        <BoothEntryList
          kind="income"
          boothId={boothId}
          entries={entries}
          currency={currency}
          readOnly={closed}
          appearance="entry"
        />
      </div>
    </div>
  );
}
