"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";
import { EntryField } from "@/components/entry/EntryField";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import type { ProjectFundingKey } from "@/lib/project-categories";
import type { ProjectIncome } from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectClosedBanner } from "@/components/project/ProjectClosedBanner";
import { FundingSourceGrid } from "@/components/project/ProjectEntryGrids";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function ProjectIncomeForm({
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
  entries: ProjectIncome[];
  currency?: string;
  backHref: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState<ProjectFundingKey>("faculty_grant");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
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
    const res = await apiFetch<ProjectIncome>(
      `/api/projects/${projectId}/activities/${activityId}/income`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          source,
          label: label.trim() || undefined,
          note: note.trim() || undefined,
          entryDate: date,
        }),
      },
    );
    if (res.ok) {
      setRaw("");
      if (source !== "other_income") setLabel("");
      setNote("");
      router.refresh();
    } else {
      setError(res.fields?.label?.[0] ?? res.fields?.amount?.[0] ?? res.message);
    }
    setSaving(false);
  }

  return (
    <div className="flex min-h-[calc(100dvh-57px-61px)] flex-col" data-context="project">
      <div className="flex items-center justify-between px-4 py-3">
        <ProjectBack href={backHref} />
        <div className="min-w-0 text-center">
          <h1 className="text-base font-medium text-rz-text">บันทึกเงินเข้า</h1>
          <p className="truncate text-xs text-rz-purple">{activityName}</p>
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
          <p className="mb-1.5 text-xs text-rz-muted">แหล่งเงิน</p>
          <FundingSourceGrid
            value={source}
            onChange={(next) => {
              if (next !== "other_income" && source === "other_income") setLabel("");
              setSource(next);
            }}
            disabled={closed}
          />
        </div>

        {source === "other_income" && (
          <EntryField
            label="ชื่อแหล่งเงิน"
            placeholder="เช่น เงินบริจาคจากศิษย์เก่า"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            disabled={closed}
            accent="blue"
          />
        )}
      </div>

      <AmountInput value={formatTyped(raw)} tone="income" currency={currency} />

      <div className="flex flex-col gap-3 px-4">
        {source !== "other_income" && (
          <EntryField
            label="ป้ายกำกับ (ไม่บังคับ)"
            placeholder="เช่น งบจากคณะ งวด 1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            disabled={closed}
            accent="blue"
          />
        )}

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
            saveLabel="บันทึกเงินเข้า"
            accent="green"
          />
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการที่บันทึกแล้ว</h2>
        <div className="p-4">
          <ProjectEntryList incomes={entries} expenses={[]} kind="income" currency={currency} />
        </div>
      </div>
    </div>
  );
}
