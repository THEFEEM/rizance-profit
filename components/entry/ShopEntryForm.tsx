"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryPageHeader } from "@/components/entry/EntryPageHeader";
import { EntryToggle, parseEntryTab, type EntryTab } from "@/components/entry/EntryToggle";
import { RegularExpenseFields } from "@/components/entry/fields/RegularExpenseFields";
import { RegularIncomeFields } from "@/components/entry/fields/RegularIncomeFields";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { EntryList, type EntryRow } from "@/components/EntryList";
import { apiFetch } from "@/lib/api-client";
import { today } from "@/lib/date";
import type { Expense, ExpenseCategoryKey, Income, IncomeCategoryKey, PaymentMethod } from "@/types";

function mergeShopEntries(incomes: Income[], expenses: Expense[]): EntryRow[] {
  const rows: EntryRow[] = [
    ...incomes.map((e) => ({
      id: e.id,
      kind: "income" as const,
      amount: e.amount,
      note: e.note,
      category: e.category,
      createdAt: e.createdAt,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      kind: "expense" as const,
      amount: e.amount,
      note: e.note,
      category: e.category,
      createdAt: e.createdAt,
    })),
  ];
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, 20);
}

export function ShopEntryForm({
  initialTab,
  incomes,
  expenses,
  currency = "THB",
}: {
  initialTab?: string | null;
  incomes: Income[];
  expenses: Expense[];
  currency?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EntryTab>(() => parseEntryTab(initialTab));
  const [raw, setRaw] = useState("");

  const [incomeCategory, setIncomeCategory] = useState<IncomeCategoryKey>("storefront");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [incomeNote, setIncomeNote] = useState("");
  const [incomeDate, setIncomeDate] = useState(today());

  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryKey>("materials");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = today();
  const listRows = mergeShopEntries(incomes, expenses);

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
      const res = await apiFetch<Income>("/api/income", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category: incomeCategory,
          paymentMethod,
          note: incomeNote.trim() || undefined,
          entryDate: incomeDate,
        }),
      });
      if (res.ok) {
        setRaw("");
        router.refresh();
      } else {
        setError(res.fields?.amount?.[0] ?? res.message);
      }
    } else {
      const res = await apiFetch<Expense>("/api/expense", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category: expenseCategory,
          note: expenseNote.trim() || undefined,
          entryDate: expenseDate,
        }),
      });
      if (res.ok) {
        setRaw("");
        router.refresh();
      } else {
        setError(res.fields?.amount?.[0] ?? res.message);
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
          accent="green"
          saveTone={isIncome ? "green" : "red"}
          saveLabel={isIncome ? "บันทึก รายรับ" : "บันทึก รายจ่าย"}
          currency={currency}
        />
      }
    >
      <EntryPageHeader title="บันทึกรายการ" />
      <EntryContextBanner target="regular" />
      <EntryToggle value={tab} onChange={switchTab} disabled={saving} />

      <div className="flex flex-col gap-3 px-4 pb-4">
        {isIncome ? (
          <RegularIncomeFields
            category={incomeCategory}
            onCategoryChange={setIncomeCategory}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            note={incomeNote}
            onNoteChange={setIncomeNote}
            date={incomeDate}
            onDateChange={setIncomeDate}
            maxDate={maxDate}
            disabled={saving}
          />
        ) : (
          <RegularExpenseFields
            category={expenseCategory}
            onCategoryChange={setExpenseCategory}
            note={expenseNote}
            onNoteChange={setExpenseNote}
            date={expenseDate}
            onDateChange={setExpenseDate}
            maxDate={maxDate}
            disabled={saving}
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
          <EntryList entries={listRows} currency={currency} appearance="today" />
        </div>
      </div>
    </EntryFormLayout>
  );
}
