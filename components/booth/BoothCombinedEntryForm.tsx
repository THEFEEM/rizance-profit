"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AmountPadSection } from "@/components/entry/AmountPadSection";
import { EntryFormLayout } from "@/components/entry/EntryFormLayout";
import { EntryToggle, parseEntryTab, type EntryTab } from "@/components/entry/EntryToggle";
import { BoothExpenseFields } from "@/components/entry/fields/BoothExpenseFields";
import { BoothIncomeFields } from "@/components/entry/fields/BoothIncomeFields";
import { BoothBack } from "@/components/booth/BoothBack";
import { BoothClosedBanner } from "@/components/booth/BoothClosedBanner";
import { BoothRemainingBar } from "@/components/booth/BoothSetup";
import { EntryContextBanner } from "@/components/EntryContextBanner";
import { BoothEntryList } from "@/components/booth/BoothEntryList";
import { apiFetch } from "@/lib/api-client";
import { clampDateToRange } from "@/lib/date";
import type { ExpenseCategoryKey, IncomeCategoryKey, PaymentMethod } from "@/types";
import type { BoothExpense, BoothIncome, BoothMember } from "@/types/booth";

type PayerKind = "member" | "external";

export function BoothCombinedEntryForm({
  boothId,
  boothName,
  startDate,
  endDate,
  closed,
  defaultDate,
  incomes,
  expenses,
  members,
  totalBudget,
  totalExpense,
  currency = "THB",
  initialTab,
}: {
  boothId: string;
  boothName: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  defaultDate: string;
  incomes: BoothIncome[];
  expenses: BoothExpense[];
  members: BoothMember[];
  totalBudget: string;
  totalExpense: string;
  currency?: string;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EntryTab>(() => parseEntryTab(initialTab));
  const [raw, setRaw] = useState("");
  const clamp = (d: string) => clampDateToRange(d, startDate, endDate);

  const [incomeCategory, setIncomeCategory] = useState<IncomeCategoryKey>("storefront");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [incomeNote, setIncomeNote] = useState("");
  const [incomeDate, setIncomeDate] = useState(defaultDate);

  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryKey>("materials");
  const [label, setLabel] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(defaultDate);
  const [advancePayment, setAdvancePayment] = useState(false);
  const [payerKind, setPayerKind] = useState<PayerKind>("member");
  const [payerMemberId, setPayerMemberId] = useState("");
  const [externalPayerName, setExternalPayerName] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchTab(next: EntryTab) {
    if (next !== tab) {
      setRaw("");
      setError(null);
      setTab(next);
    }
  }

  function onAdvancePaymentChange(checked: boolean) {
    setAdvancePayment(checked);
    if (!checked) {
      setPayerMemberId("");
      setExternalPayerName("");
    }
  }

  async function save() {
    if (closed) return;
    setSaving(true);
    setError(null);

    if (tab === "income") {
      const res = await apiFetch<BoothIncome>(`/api/booths/${boothId}/income`, {
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
        setIncomeNote("");
        router.refresh();
      } else {
        setError(res.fields?.amount?.[0] ?? res.message);
      }
    } else {
      const res = await apiFetch<BoothExpense>(`/api/booths/${boothId}/expense`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(raw),
          category: expenseCategory,
          label: label.trim() || undefined,
          note: expenseNote.trim() || undefined,
          entryDate: expenseDate,
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
        setExpenseNote("");
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
          closed={closed}
          tone={isIncome ? "income" : "expense"}
          accent="amber"
          saveTone={isIncome ? undefined : "red"}
          saveLabel={isIncome ? "บันทึก รายรับ" : "บันทึก รายจ่าย"}
          currency={currency}
        />
      }
    >
      <div className="flex items-center justify-between px-4 py-3">
        <BoothBack href={`/booth/${boothId}`} />
        <h1 className="text-base font-medium text-rz-text">บันทึกรายการ</h1>
        <span className="w-16" aria-hidden />
      </div>
      <EntryContextBanner target="booth" name={boothName} />
      <EntryToggle value={tab} onChange={switchTab} disabled={saving || closed} />

      {!isIncome && (
        <BoothRemainingBar
          totalBudget={totalBudget}
          totalExpense={totalExpense}
          currency={currency}
          appearance="entry"
        />
      )}

      {closed && (
        <div className="mb-3">
          <BoothClosedBanner />
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 pb-4">
        {isIncome ? (
          <BoothIncomeFields
            category={incomeCategory}
            onCategoryChange={setIncomeCategory}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
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
          <BoothExpenseFields
            category={expenseCategory}
            onCategoryChange={setExpenseCategory}
            label={label}
            onLabelChange={setLabel}
            note={expenseNote}
            onNoteChange={setExpenseNote}
            date={expenseDate}
            onDateChange={(d) => setExpenseDate(clamp(d))}
            startDate={startDate}
            endDate={endDate}
            defaultDate={defaultDate}
            advancePayment={advancePayment}
            onAdvancePaymentChange={onAdvancePaymentChange}
            payerKind={payerKind}
            onPayerKindChange={setPayerKind}
            payerMemberId={payerMemberId}
            onPayerMemberIdChange={setPayerMemberId}
            externalPayerName={externalPayerName}
            onExternalPayerNameChange={setExternalPayerName}
            members={members}
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
          <BoothEntryList
            kind="all"
            boothId={boothId}
            incomes={incomes}
            expenses={expenses}
            currency={currency}
            readOnly={closed}
            appearance="entry"
          />
        </div>
      </div>
    </EntryFormLayout>
  );
}
