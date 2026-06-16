"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { EntryField } from "@/components/entry/EntryField";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import type { ProjectExpenseKey } from "@/lib/project-categories";
import type { PaymentStatus, ProjectExpense } from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectClosedBanner } from "@/components/project/ProjectClosedBanner";
import { ExpenseCategoryGrid } from "@/components/project/ProjectEntryGrids";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import { PaymentStatusPicker } from "@/components/project/PaymentStatusPicker";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function ProjectExpenseForm({
  projectId,
  activityId,
  activityName,
  startDate,
  endDate,
  closed,
  defaultDate,
  entries,
  currency = "THB",
  backHref,
}: {
  projectId: string;
  activityId: string;
  activityName: string;
  startDate: string | null;
  endDate: string | null;
  closed: boolean;
  defaultDate: string;
  entries: ProjectExpense[];
  currency?: string;
  backHref: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [category, setCategory] = useState<ProjectExpenseKey>("venue");
  const [payerName, setPayerName] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = (d: string) => {
    if (startDate && endDate) return clampDateToRange(d, startDate, endDate);
    if (startDate && d < startDate) return startDate;
    if (endDate && d > endDate) return endDate;
    return d;
  };

  async function save() {
    if (closed) return;
    setSaving(true);
    setError(null);
    const res = await apiFetch<ProjectExpense>(
      `/api/projects/${projectId}/activities/${activityId}/expense`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category,
          payerName: payerName.trim() || undefined,
          label: label.trim() || undefined,
          note: note.trim() || undefined,
          entryDate: date,
          paymentStatus,
        }),
      },
    );
    if (res.ok) {
      setRaw("");
      setPayerName("");
      setLabel("");
      setNote("");
      router.refresh();
    } else {
      setError(res.fields?.amount?.[0] ?? res.message);
    }
    setSaving(false);
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col" data-context="project">
      <div className="flex items-center justify-between px-4 py-3">
        <ProjectBack href={backHref} />
        <div className="min-w-0 text-center">
          <h1 className="text-base font-medium text-rz-text">บันทึกรายจ่าย</h1>
          <p className="truncate text-xs text-rz-blue">{activityName}</p>
        </div>
        <span className="w-16" aria-hidden />
      </div>

      {closed && (
        <div className="mb-3">
          <ProjectClosedBanner />
        </div>
      )}

      <div className="flex flex-col gap-3 px-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">หมวดรายจ่าย</p>
          <ExpenseCategoryGrid value={category} onChange={setCategory} disabled={closed} />
        </div>
      </div>

      <AmountInput value={formatTyped(raw)} tone="expense" currency={currency} />

      <div className="flex flex-col gap-3 px-4">
        <EntryField
          label="ผู้จ่าย (ไม่บังคับ)"
          placeholder="เช่น เหรัญญิก / สมาชิก"
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          maxLength={120}
          disabled={closed}
          accent="blue"
        />
        <EntryField
          label="ป้ายกำกับ (ไม่บังคับ)"
          placeholder="เช่น ค่าที่ / นม / แก้ว"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          disabled={closed}
          accent="blue"
        />
        <EntryField
          label="วันที่"
          type="date"
          value={date}
          min={startDate ?? undefined}
          max={endDate ?? undefined}
          disabled={closed}
          onChange={(e) => setDate(clamp(e.target.value || defaultDate))}
          accent="blue"
        />

        <PaymentStatusPicker
          value={paymentStatus}
          onChange={setPaymentStatus}
          disabled={closed}
        />

        <ProjectTextArea
          label="หมายเหตุ (ไม่บังคับ)"
          placeholder="รายละเอียดเพิ่มเติม"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={255}
          disabled={closed}
          rows={2}
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
            saveLabel="บันทึกรายจ่าย"
            accent="green"
            saveTone="red"
          />
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการที่บันทึกแล้ว</h2>
        <div className="p-4">
          <ProjectEntryList incomes={[]} expenses={entries} kind="expense" currency={currency} />
        </div>
      </div>
    </div>
  );
}
