"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { EntryToggle, parseEntryTab, type EntryTab } from "@/components/entry/EntryToggle";
import {
  PersonalExpenseFields,
  PersonalIncomeFields,
} from "@/components/entry/fields/PersonalEntryFields";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import {
  PERSONAL_SAVINGS_DEPOSIT,
  PERSONAL_SAVINGS_WITHDRAWAL,
  type PersonalExpenseKey,
  type PersonalIncomeKey,
} from "@/lib/personal-categories";
import type { PersonalEntryRow, PersonalExpense, PersonalIncome, SavingsGoal } from "@/types/personal";

function toEntryRows(entries: PersonalEntryRow[]): EntryRow[] {
  return entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    note: e.note,
    category: e.category,
    createdAt: e.createdAt,
    savingsGoalName: e.savingsGoalName ?? undefined,
  }));
}

export function PersonalEntryForm({
  initialTab,
  entries,
  goals,
  currency = "THB",
}: {
  initialTab?: string | null;
  entries: PersonalEntryRow[];
  goals: SavingsGoal[];
  currency?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EntryTab>(() => parseEntryTab(initialTab));
  const [raw, setRaw] = useState("");

  const [incomeCategory, setIncomeCategory] = useState<PersonalIncomeKey>("salary");
  const [incomeNote, setIncomeNote] = useState("");
  const [incomeDate, setIncomeDate] = useState(today());
  const [incomeGoalId, setIncomeGoalId] = useState("");

  const [expenseCategory, setExpenseCategory] = useState<PersonalExpenseKey>("food");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());
  const [expenseGoalId, setExpenseGoalId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = today();
  const listRows = toEntryRows(entries);

  function switchTab(next: EntryTab) {
    if (next !== tab) {
      setRaw("");
      setError(null);
      setTab(next);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);

    if (tab === "income") {
      const isSavings = incomeCategory === PERSONAL_SAVINGS_WITHDRAWAL;
      if (isSavings && !incomeGoalId) {
        setError("กรุณาเลือกเป้าหมายออม");
        setSaving(false);
        return;
      }
      const res = await apiFetch<PersonalIncome>("/api/personal/income", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category: incomeCategory,
          note: incomeNote.trim() || undefined,
          entryDate: incomeDate,
          savingsGoalId: isSavings ? incomeGoalId : undefined,
        }),
      });
      if (res.ok) {
        setRaw("");
        setIncomeGoalId("");
        router.refresh();
      } else {
        setError(res.fields?.savingsGoalId?.[0] ?? res.fields?.amount?.[0] ?? res.message);
      }
    } else {
      const isSavings = expenseCategory === PERSONAL_SAVINGS_DEPOSIT;
      if (isSavings && !expenseGoalId) {
        setError("กรุณาเลือกเป้าหมายออม");
        setSaving(false);
        return;
      }
      const res = await apiFetch<PersonalExpense>("/api/personal/expense", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category: expenseCategory,
          note: expenseNote.trim() || undefined,
          entryDate: expenseDate,
          savingsGoalId: isSavings ? expenseGoalId : undefined,
        }),
      });
      if (res.ok) {
        setRaw("");
        setExpenseGoalId("");
        router.refresh();
      } else {
        setError(res.fields?.savingsGoalId?.[0] ?? res.fields?.amount?.[0] ?? res.message);
      }
    }

    setSaving(false);
  }

  const isIncome = tab === "income";

  return (
    <EntryFormLayout
      pad={
        <AmountPadSection
          raw={raw}
          onChange={setRaw}
          onSave={save}
          saving={saving}
          tone={isIncome ? "income" : "expense"}
          saveTone={isIncome ? "green" : "red"}
          saveLabel={isIncome ? "บันทึก รายรับ" : "บันทึก รายจ่าย"}
          currency={currency}
        />
      }
    >
      <EntryPageHeader title="บันทึกรายการ" />
      <EntryContextBanner target="personal" />
      <EntryToggle value={tab} onChange={switchTab} disabled={saving} />

      <div className="flex flex-col gap-3 px-4 pb-4">
        {isIncome ? (
          <PersonalIncomeFields
            category={incomeCategory}
            onCategoryChange={setIncomeCategory}
            note={incomeNote}
            onNoteChange={setIncomeNote}
            date={incomeDate}
            onDateChange={setIncomeDate}
            maxDate={maxDate}
            disabled={saving}
            goals={goals}
            savingsGoalId={incomeGoalId}
            onSavingsGoalChange={setIncomeGoalId}
          />
        ) : (
          <PersonalExpenseFields
            category={expenseCategory}
            onCategoryChange={setExpenseCategory}
            note={expenseNote}
            onNoteChange={setExpenseNote}
            date={expenseDate}
            onDateChange={setExpenseDate}
            maxDate={maxDate}
            disabled={saving}
            goals={goals}
            savingsGoalId={expenseGoalId}
            onSavingsGoalChange={setExpenseGoalId}
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
          <EntryList
            entries={listRows}
            currency={currency}
            appearance="today"
            ledger="personal"
          />
        </div>
      </div>
    </EntryFormLayout>
  );
}
