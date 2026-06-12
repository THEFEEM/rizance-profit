"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { Input } from "@/components/ui/Input";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothRemainingBar } from "@/components/booth/BoothSetup";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { BoothEntryList } from "@/components/booth/BoothEntryList";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import {
  BOOTH_COST_TYPE_LABELS,
  BOOTH_COST_TYPES,
  type BoothCostType,
  type BoothExpense,
  type BoothMember,
} from "@/types/booth";

type PayerKind = "member" | "external";

export function BoothExpenseForm({
  boothId,
  boothName,
  startDate,
  endDate,
  closed,
  defaultDate,
  entries,
  members,
  totalBudget,
  totalExpense,
  currency = "THB",
}: {
  boothId: string;
  boothName: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  defaultDate: string;
  entries: BoothExpense[];
  members: BoothMember[];
  totalBudget: string;
  totalExpense: string;
  currency?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [costType, setCostType] = useState<BoothCostType>("variable");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [advancePayment, setAdvancePayment] = useState(false);
  const [payerKind, setPayerKind] = useState<PayerKind>("member");
  const [payerMemberId, setPayerMemberId] = useState("");
  const [externalPayerName, setExternalPayerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = (d: string) => clampDateToRange(d, startDate, endDate);

  async function save() {
    if (closed) return;
    setSaving(true);
    setError(null);
    const res = await apiFetch<BoothExpense>(`/api/booths/${boothId}/expense`, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(raw),
        costType,
        label: label.trim() || undefined,
        note: note.trim() || undefined,
        entryDate: date,
        advancePayment,
        payerMemberId:
          advancePayment && payerKind === "member" && payerMemberId ? payerMemberId : undefined,
        externalPayerName:
          advancePayment && payerKind === "external" ? externalPayerName.trim() : undefined,
      }),
    });
    if (res.ok) {
      setRaw("");
      setLabel("");
      setNote("");
      setAdvancePayment(false);
      setPayerMemberId("");
      setExternalPayerName("");
      setPayerKind("member");
      router.refresh();
    } else {
      setError(res.fields?.amount?.[0] ?? res.fields?.externalPayerName?.[0] ?? res.fields?.payerMemberId?.[0] ?? res.message);
    }
    setSaving(false);
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <BoothBack href={`/booth/${boothId}`} />
        <h1 className="text-base font-bold text-slate-900">รายจ่ายบูธ</h1>
        <span className="w-16" />
      </div>
      <EntryContextBanner target="booth" name={boothName} />

      <BoothRemainingBar
        totalBudget={totalBudget}
        totalExpense={totalExpense}
        currency={currency}
      />

      {closed && (
        <div className="mb-3">
          <BoothClosedBanner />
        </div>
      )}

      <AmountInput value={formatTyped(raw)} tone="expense" />

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">ประเภทต้นทุน</p>
          <div className="flex flex-col gap-2">
            {BOOTH_COST_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                disabled={closed}
                onClick={() => setCostType(t)}
                className={`tap-target rounded-2xl border px-4 py-2.5 text-left text-sm font-medium transition-colors disabled:opacity-50 ${
                  costType === t
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
                }`}
              >
                {BOOTH_COST_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <input
            type="checkbox"
            checked={advancePayment}
            disabled={closed}
            onChange={(e) => {
              setAdvancePayment(e.target.checked);
              if (!e.target.checked) {
                setPayerMemberId("");
                setExternalPayerName("");
              }
            }}
            className="h-4 w-4"
          />
          <span className="text-sm text-slate-700">ออกเงินก่อน (จ่ายแทนร้าน)</span>
        </label>

        {advancePayment && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-medium text-slate-700">ผู้จ่ายแทน</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={closed}
                onClick={() => setPayerKind("member")}
                className={`tap-target flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  payerKind === "member"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                สมาชิก
              </button>
              <button
                type="button"
                disabled={closed}
                onClick={() => setPayerKind("external")}
                className={`tap-target flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  payerKind === "external"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                บุคคลภายนอก
              </button>
            </div>

            {payerKind === "member" ? (
              members.length > 0 ? (
                <select
                  value={payerMemberId}
                  disabled={closed}
                  onChange={(e) => setPayerMemberId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"
                >
                  <option value="">เลือกสมาชิก</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-500">ยังไม่มีสมาชิก — เลือกบุคคลภายนอกแทน</p>
              )
            ) : (
              <Input
                label="ชื่อผู้จ่ายแทน"
                placeholder="เช่น ครูสมชาย / ร้านค้า"
                value={externalPayerName}
                onChange={(e) => setExternalPayerName(e.target.value)}
                maxLength={120}
                disabled={closed}
              />
            )}
          </div>
        )}

        <Input
          label="ชื่อรายการ (ไม่บังคับ)"
          placeholder="ค่าที่ / นม / แก้ว"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          disabled={closed}
        />
        <Input
          label="หมายเหตุ (ไม่บังคับ)"
          placeholder="รายละเอียดเพิ่มเติม"
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
          kind="expense"
          boothId={boothId}
          entries={entries}
          currency={currency}
          readOnly={closed}
        />
      </div>
    </div>
  );
}
