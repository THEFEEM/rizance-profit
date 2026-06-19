"use client";

import { AmountInput } from "@/components/ui/AmountInput";
import { QuickAmountPad, formatTyped } from "@/components/QuickAmountPad";

export function AmountPadSection({
  raw,
  onChange,
  onSave,
  saving = false,
  closed = false,
  saveLabel = "SAVE",
  accent = "green",
  saveTone,
  currency = "THB",
  tone = "income",
  closedMessage = "ฟอร์มถูกปิดใช้งาน",
}: {
  raw: string;
  onChange: (next: string) => void;
  onSave: () => void;
  saving?: boolean;
  closed?: boolean;
  saveLabel?: string;
  accent?: "green" | "amber";
  saveTone?: "green" | "amber" | "red";
  currency?: string;
  tone?: "income" | "expense";
  closedMessage?: string;
}) {
  return (
    <div className="shrink-0 border-t-[0.5px] border-rz-border bg-rz-bg">
      <AmountInput value={formatTyped(raw)} tone={tone} currency={currency} compact />
      <div className="px-2 pb-3">
        {closed ? (
          <p className="px-2 py-4 text-center text-sm text-rz-hint">{closedMessage}</p>
        ) : (
          <QuickAmountPad
            value={raw}
            onChange={onChange}
            onSave={onSave}
            saving={saving}
            saveLabel={saveLabel}
            accent={accent}
            saveTone={saveTone}
          />
        )}
      </div>
    </div>
  );
}
