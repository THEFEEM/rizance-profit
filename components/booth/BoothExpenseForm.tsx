"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothRemainingBar } from "@/components/booth/BoothSetup";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { BoothEntryList } from "@/components/booth/BoothEntryList";
import { CategoryGrid } from "@/components/CategoryGrid";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import {
  EXPENSE_CATEGORY_GRID_OPTIONS,
  type ExpenseCategoryKey,
} from "@/types";
import { type BoothExpense, type BoothMember } from "@/types/booth";

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
  const [category, setCategory] = useState<ExpenseCategoryKey>("materials");
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
        category,
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
      setError(
        res.fields?.amount?.[0] ??
          res.fields?.externalPayerName?.[0] ??
          res.fields?.payerMemberId?.[0] ??
          res.message,
      );
    }
    setSaving(false);
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <BoothBack href={`/booth/${boothId}`} />
        <h1 className="text-base font-medium text-rz-text">รายจ่ายบูธ</h1>
        <span className="w-16" aria-hidden />
      </div>
      <EntryContextBanner target="booth" name={boothName} />

      <BoothRemainingBar
        totalBudget={totalBudget}
        totalExpense={totalExpense}
        currency={currency}
        appearance="entry"
      />

      {closed && (
        <div className="mb-3">
          <BoothClosedBanner />
        </div>
      )}

      <AmountInput value={formatTyped(raw)} tone="expense" />

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ประเภทรายจ่าย</p>
          <CategoryGrid
            options={EXPENSE_CATEGORY_GRID_OPTIONS}
            value={category}
            onChange={setCategory}
            columns={2}
            accent="amber"
          />
        </div>

        <label className="flex items-center gap-3 rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
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
            className="h-4 w-4 accent-rz-amber"
          />
          <span className="text-sm text-rz-text">ออกเงินก่อน (จ่ายแทนร้าน)</span>
        </label>

        {advancePayment && (
          <div className="space-y-3 rounded-[11px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3">
            <p className="text-sm font-medium text-rz-muted">ผู้จ่ายแทน</p>
            <div className="flex gap-2">
              <EntryOptionButton
                selected={payerKind === "member"}
                disabled={closed}
                onClick={() => setPayerKind("member")}
                accent="amber"
                layout="row"
                className="flex-1"
              >
                สมาชิก
              </EntryOptionButton>
              <EntryOptionButton
                selected={payerKind === "external"}
                disabled={closed}
                onClick={() => setPayerKind("external")}
                accent="amber"
                layout="row"
                className="flex-1"
              >
                บุคคลภายนอก
              </EntryOptionButton>
            </div>

            {payerKind === "member" ? (
              members.length > 0 ? (
                <select
                  value={payerMemberId}
                  disabled={closed}
                  onChange={(e) => setPayerMemberId(e.target.value)}
                  className="tap-target w-full rounded-[11px] border-[0.5px] border-rz-border bg-rz-elevated px-[13px] py-[13px] text-sm text-rz-text outline-none focus:border-rz-amber"
                >
                  <option value="">เลือกสมาชิก</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-rz-hint">ยังไม่มีสมาชิก — เลือกบุคคลภายนอกแทน</p>
              )
            ) : (
              <EntryField
                label="ชื่อผู้จ่ายแทน"
                placeholder="เช่น ครูสมชาย / ร้านค้า"
                value={externalPayerName}
                onChange={(e) => setExternalPayerName(e.target.value)}
                maxLength={120}
                disabled={closed}
                accent="amber"
              />
            )}
          </div>
        )}

        <EntryField
          label="ชื่อรายการ (ไม่บังคับ)"
          placeholder="ค่าที่ / นม / แก้ว"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          disabled={closed}
          accent="amber"
        />
        <EntryField
          label="หมายเหตุ (ไม่บังคับ)"
          placeholder="รายละเอียดเพิ่มเติม"
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
          kind="expense"
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
