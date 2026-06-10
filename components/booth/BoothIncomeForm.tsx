"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { Input } from "@/components/ui/Input";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { BoothEntryList } from "@/components/booth/BoothEntryList";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type BoothIncome,
  type PaymentMethod,
} from "@/types/booth";

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
        <h1 className="text-base font-bold text-slate-900">รายรับบูธ</h1>
        <span className="w-16" />
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
          <p className="mb-1.5 text-sm font-medium text-slate-700">ช่องทางรับเงิน</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={closed}
                onClick={() => setPaymentMethod(m)}
                className={`tap-target rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                  paymentMethod === m
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
                }`}
              >
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="หมายเหตุ (ไม่บังคับ)"
          placeholder="ยอดขายเช้า"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
          disabled={closed}
        />
        <Input
          label="วันที่"
          type="date"
          value={date}
          min={startDate}
          max={endDate}
          disabled={closed}
          onChange={(e) => setDate(clamp(e.target.value || defaultDate))}
        />
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-auto px-2 pb-3">
        {closed ? (
          <p className="px-2 py-4 text-center text-sm text-slate-400">ฟอร์มถูกปิดใช้งาน</p>
        ) : (
          <QuickAmountPad value={raw} onChange={setRaw} onSave={save} saving={saving} saveLabel="บันทึก" />
        )}
      </div>

      <div className="border-t border-slate-100">
        <h2 className="px-4 pt-4 text-sm font-semibold text-slate-700">รายการที่บันทึกแล้ว</h2>
        <BoothEntryList
          kind="income"
          boothId={boothId}
          entries={entries}
          currency={currency}
          readOnly={closed}
        />
      </div>
    </div>
  );
}
