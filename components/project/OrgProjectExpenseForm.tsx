"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import type { ProjectExpenseKey, ProjectFundingKey } from "@/lib/project-categories";
import type { FundBalance, ProjectExpense } from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectClosedBanner } from "@/components/project/ProjectClosedBanner";
import { FundSourceBalanceGrid } from "@/components/project/FundSourceBalanceGrid";
import { ProjectActivityPicker } from "@/components/project/ProjectActivityPicker";
import type { ActivityPickerOption } from "@/components/project/ProjectActivityPicker";
import { ExpenseCategoryGrid } from "@/components/project/ProjectEntryGrids";
import { OrgProjectEntryList } from "@/components/project/OrgProjectEntryList";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function OrgProjectExpenseForm({
  projectId,
  projectName,
  generalActivityId,
  activityOptions,
  activityNames,
  fundBreakdown,
  startDate,
  endDate,
  closed,
  defaultDate,
  entries,
  currency = "THB",
  backHref,
}: {
  projectId: string;
  projectName: string;
  generalActivityId: string;
  activityOptions: ActivityPickerOption[];
  activityNames: Record<string, string>;
  fundBreakdown: FundBalance[];
  startDate: string | null;
  endDate: string | null;
  closed: boolean;
  defaultDate: string;
  entries: ProjectExpense[];
  currency?: string;
  backHref: string;
}) {
  const router = useRouter();
  const defaultActivityId =
    activityOptions.find((a) => !a.isGeneral)?.activityId ?? generalActivityId;

  const [raw, setRaw] = useState("");
  const [fundSource, setFundSource] = useState<ProjectFundingKey | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState(defaultActivityId);
  const [isAdvance, setIsAdvance] = useState(false);
  const [category, setCategory] = useState<ProjectExpenseKey>("venue");
  const [payerName, setPayerName] = useState("");
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
    if (isAdvance && !payerName.trim()) {
      setError("กรุณาระบุผู้ออกเงินเมื่อเลือกสำรองจ่าย");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await apiFetch<ProjectExpense>(
      `/api/projects/${projectId}/activities/${selectedActivityId}/expense`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category,
          fundSource,
          isAdvance,
          payerName: payerName.trim() || undefined,
          label: label.trim() || undefined,
          note: note.trim() || undefined,
          entryDate: date,
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
      setError(
        res.fields?.payerName?.[0] ??
          res.fields?.amount?.[0] ??
          res.message,
      );
    }
    setSaving(false);
  }

  return (
    <EntryFormLayout
      dataContext="project"
      pad={
        <AmountPadSection
          raw={raw}
          onChange={setRaw}
          onSave={save}
          saving={saving}
          closed={closed}
          saveLabel="บันทึกรายจ่าย"
          tone="expense"
          accent="green"
          saveTone="red"
          currency={currency}
        />
      }
    >
      <div className="flex items-center justify-between px-4 py-3">
        <ProjectBack href={backHref} />
        <div className="min-w-0 text-center">
          <h1 className="text-base font-medium text-rz-text">บันทึกรายจ่าย</h1>
          <p className="truncate text-xs text-rz-purple">{projectName}</p>
        </div>
        <span className="w-16" aria-hidden />
      </div>

      {closed && (
        <div className="mb-3">
          <ProjectClosedBanner projectType="long" />
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <p className="mb-1.5 text-xs text-rz-muted">แหล่งเงินทุน (ไม่บังคับ)</p>
          <FundSourceBalanceGrid
            value={fundSource}
            onChange={setFundSource}
            fundBreakdown={fundBreakdown}
            disabled={closed}
            currency={currency}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">เลือกกิจกรรม</p>
          <ProjectActivityPicker
            activities={activityOptions}
            generalActivityId={generalActivityId}
            selectedActivityId={selectedActivityId}
            onChange={setSelectedActivityId}
            disabled={closed}
            currency={currency}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ออกเงินก่อน (สำรองจ่าย)</p>
          <div className="flex flex-wrap gap-2">
            <EntryOptionButton
              selected={!isAdvance}
              onClick={() => setIsAdvance(false)}
              disabled={closed}
              accent="green"
            >
              ปกติ
            </EntryOptionButton>
            <EntryOptionButton
              selected={isAdvance}
              onClick={() => setIsAdvance(true)}
              disabled={closed}
              accent="amber"
            >
              สำรองจ่าย
            </EntryOptionButton>
          </div>
        </div>

        {isAdvance && (
          <EntryField
            label="ผู้ออกเงิน"
            placeholder="เช่น น้องเอ / เหรัญญิก"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            maxLength={120}
            disabled={closed}
            accent="blue"
          />
        )}

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">หมวดรายจ่าย</p>
          <ExpenseCategoryGrid value={category} onChange={setCategory} disabled={closed} />
        </div>

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

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการรายจ่ายทั้งองค์กร</h2>
        <div className="p-4">
          <OrgProjectEntryList
            incomes={[]}
            expenses={entries}
            activityNames={activityNames}
            generalActivityId={generalActivityId}
            kind="expense"
            currency={currency}
          />
        </div>
      </div>
    </EntryFormLayout>
  );
}
