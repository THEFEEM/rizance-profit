"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryField } from "@/components/entry/EntryField";
import { EntryOptionButton } from "@/components/entry/EntryOptionButton";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import { PAYMENT_METHOD_LABELS } from "@/lib/expense-categories";
import type { ProjectFundingKey } from "@/lib/project-categories";
import type {
  ProjectIncome,
  ProjectIncomePaymentMethod,
} from "@/types/project";
import { PROJECT_INCOME_PAYMENT_METHODS } from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectClosedBanner } from "@/components/project/ProjectClosedBanner";
import { FundingSourceGrid } from "@/components/project/ProjectEntryGrids";
import { OrgProjectEntryList } from "@/components/project/OrgProjectEntryList";
import { ProjectTextArea } from "@/components/project/ProjectField";

export function OrgProjectIncomeForm({
  projectId,
  projectName,
  generalActivityId,
  activityNames,
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
  activityNames: Record<string, string>;
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
  const [paymentMethod, setPaymentMethod] = useState<ProjectIncomePaymentMethod>("cash");
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
      `/api/projects/${projectId}/activities/${generalActivityId}/income`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          source,
          paymentMethod,
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
    <EntryFormLayout
      dataContext="project"
      pad={
        <AmountPadSection
          raw={raw}
          onChange={setRaw}
          onSave={save}
          saving={saving}
          closed={closed}
          saveLabel="บันทึกเงินเข้า"
          tone="income"
          accent="green"
          currency={currency}
        />
      }
    >
      <div className="flex items-center justify-between px-4 py-3">
        <ProjectBack href={backHref} />
        <div className="min-w-0 text-center">
          <h1 className="text-base font-medium text-rz-text">บันทึกเงินเข้า</h1>
          <p className="truncate text-xs text-rz-purple">{projectName} · กองกลาง</p>
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
          <p className="mb-1.5 text-xs text-rz-muted">แหล่งเงินทุน</p>
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

        <div>
          <p className="mb-1.5 text-xs text-rz-muted">ช่องทางรับเงิน</p>
          <div className="flex flex-wrap gap-2">
            {PROJECT_INCOME_PAYMENT_METHODS.map((m) => (
              <EntryOptionButton
                key={m}
                selected={paymentMethod === m}
                onClick={() => setPaymentMethod(m)}
                disabled={closed}
                accent="green"
              >
                {PAYMENT_METHOD_LABELS[m]}
              </EntryOptionButton>
            ))}
          </div>
        </div>

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

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการเงินเข้าทั้งองค์กร</h2>
        <div className="p-4">
          <OrgProjectEntryList
            incomes={entries}
            expenses={[]}
            activityNames={activityNames}
            generalActivityId={generalActivityId}
            kind="income"
            currency={currency}
          />
        </div>
      </div>
    </EntryFormLayout>
  );
}
