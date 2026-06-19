"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryToggle, parseEntryTab, type EntryTab } from "@/components/entry/EntryToggle";
import { OrgProjectExpenseFields } from "@/components/project/fields/OrgProjectExpenseFields";
import { OrgProjectIncomeFields } from "@/components/project/fields/OrgProjectIncomeFields";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import type { ProjectExpenseKey, ProjectFundingKey } from "@/lib/project-categories";
import type {
  FundBalance,
  ProjectExpense,
  ProjectIncome,
  ProjectIncomePaymentMethod,
} from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectClosedBanner } from "@/components/project/ProjectClosedBanner";
import { OrgProjectEntryList } from "@/components/project/OrgProjectEntryList";
import type { ActivityPickerOption } from "@/components/project/ProjectActivityPicker";

export function OrgProjectCombinedEntryForm({
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
  incomes,
  expenses,
  currency = "THB",
  backHref,
  initialTab,
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
  incomes: ProjectIncome[];
  expenses: ProjectExpense[];
  currency?: string;
  backHref: string;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const defaultActivityId =
    activityOptions.find((a) => !a.isGeneral)?.activityId ?? generalActivityId;

  const [tab, setTab] = useState<EntryTab>(() => parseEntryTab(initialTab));
  const [raw, setRaw] = useState("");
  const clamp = (d: string) => {
    if (startDate && endDate) return clampDateToRange(d, startDate, endDate);
    if (startDate && d < startDate) return startDate;
    if (endDate && d > endDate) return endDate;
    return d;
  };

  const [source, setSource] = useState<ProjectFundingKey>("faculty_grant");
  const [paymentMethod, setPaymentMethod] = useState<ProjectIncomePaymentMethod>("cash");
  const [incomeLabel, setIncomeLabel] = useState("");
  const [incomeNote, setIncomeNote] = useState("");
  const [incomeDate, setIncomeDate] = useState(defaultDate);

  const [fundSource, setFundSource] = useState<ProjectFundingKey | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState(defaultActivityId);
  const [isAdvance, setIsAdvance] = useState(false);
  const [category, setCategory] = useState<ProjectExpenseKey>("venue");
  const [payerName, setPayerName] = useState("");
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(defaultDate);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchTab(next: EntryTab) {
    if (next !== tab) {
      setRaw("");
      setError(null);
      setTab(next);
    }
  }

  function onSourceChange(next: ProjectFundingKey) {
    if (next !== "other_income" && source === "other_income") setIncomeLabel("");
    setSource(next);
  }

  async function save() {
    if (closed) return;
    if (tab === "expense" && isAdvance && !payerName.trim()) {
      setError("กรุณาระบุผู้ออกเงินเมื่อเลือกสำรองจ่าย");
      return;
    }

    setSaving(true);
    setError(null);

    if (tab === "income") {
      const res = await apiFetch<ProjectIncome>(
        `/api/projects/${projectId}/activities/${generalActivityId}/income`,
        {
          method: "POST",
          body: JSON.stringify({
            amount: Number(raw),
            source,
            paymentMethod,
            label: incomeLabel.trim() || undefined,
            note: incomeNote.trim() || undefined,
            entryDate: incomeDate,
          }),
        },
      );
      if (res.ok) {
        setRaw("");
        if (source !== "other_income") setIncomeLabel("");
        setIncomeNote("");
        router.refresh();
      } else {
        setError(res.fields?.label?.[0] ?? res.fields?.amount?.[0] ?? res.message);
      }
    } else {
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
            label: expenseLabel.trim() || undefined,
            note: expenseNote.trim() || undefined,
            entryDate: expenseDate,
          }),
        },
      );
      if (res.ok) {
        setRaw("");
        setPayerName("");
        setExpenseLabel("");
        setExpenseNote("");
        router.refresh();
      } else {
        setError(res.fields?.payerName?.[0] ?? res.fields?.amount?.[0] ?? res.message);
      }
    }

    setSaving(false);
  }

  const isIncome = tab === "income";

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
          tone={isIncome ? "income" : "expense"}
          accent="green"
          saveTone={isIncome ? "green" : "red"}
          saveLabel={isIncome ? "บันทึก รายรับ" : "บันทึก รายจ่าย"}
          currency={currency}
        />
      }
    >
      <div className="flex items-center justify-between px-4 py-3">
        <ProjectBack href={backHref} />
        <div className="min-w-0 text-center">
          <h1 className="text-base font-medium text-rz-text">บันทึกรายการ</h1>
          <p className="truncate text-xs text-rz-purple">{projectName}</p>
        </div>
        <span className="w-16" aria-hidden />
      </div>

      <EntryToggle value={tab} onChange={switchTab} disabled={saving || closed} />

      {closed && (
        <div className="mb-3">
          <ProjectClosedBanner projectType="long" />
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 pb-4">
        {isIncome ? (
          <OrgProjectIncomeFields
            source={source}
            onSourceChange={onSourceChange}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            label={incomeLabel}
            onLabelChange={setIncomeLabel}
            note={incomeNote}
            onNoteChange={setIncomeNote}
            date={incomeDate}
            onDateChange={(d) => setIncomeDate(clamp(d))}
            startDate={startDate}
            endDate={endDate}
            defaultDate={defaultDate}
            disabled={closed || saving}
          />
        ) : (
          <OrgProjectExpenseFields
            fundSource={fundSource}
            onFundSourceChange={setFundSource}
            fundBreakdown={fundBreakdown}
            selectedActivityId={selectedActivityId}
            onSelectedActivityChange={setSelectedActivityId}
            activityOptions={activityOptions}
            generalActivityId={generalActivityId}
            isAdvance={isAdvance}
            onIsAdvanceChange={setIsAdvance}
            payerName={payerName}
            onPayerNameChange={setPayerName}
            category={category}
            onCategoryChange={setCategory}
            label={expenseLabel}
            onLabelChange={setExpenseLabel}
            note={expenseNote}
            onNoteChange={setExpenseNote}
            date={expenseDate}
            onDateChange={(d) => setExpenseDate(clamp(d))}
            startDate={startDate}
            endDate={endDate}
            defaultDate={defaultDate}
            currency={currency}
            disabled={closed || saving}
          />
        )}

        {error && (
          <p className="text-sm text-rz-red" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t-[0.5px] border-rz-border">
        <h2 className="px-4 pt-4 text-xs font-medium text-rz-muted">รายการล่าสุด</h2>
        <div className="p-4">
          <OrgProjectEntryList
            incomes={incomes}
            expenses={expenses}
            activityNames={activityNames}
            generalActivityId={generalActivityId}
            kind="all"
            currency={currency}
          />
        </div>
      </div>
    </EntryFormLayout>
  );
}
