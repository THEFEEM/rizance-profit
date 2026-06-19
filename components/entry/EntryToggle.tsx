"use client";

export type EntryTab = "income" | "expense";

export function parseEntryTab(tab?: string | null): EntryTab {
  return tab === "expense" ? "expense" : "income";
}

export function EntryToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: EntryTab;
  onChange: (tab: EntryTab) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="mx-4 mb-3 flex rounded-full bg-rz-elevated p-[3px]"
      role="tablist"
      aria-label="ประเภทรายการ"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "income"}
        disabled={disabled}
        onClick={() => onChange("income")}
        className={`tap-target flex flex-1 items-center justify-center rounded-full py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          value === "income"
            ? "bg-rz-green text-rz-bg"
            : "text-rz-muted active:bg-rz-card"
        }`}
      >
        + รายรับ
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "expense"}
        disabled={disabled}
        onClick={() => onChange("expense")}
        className={`tap-target flex flex-1 items-center justify-center rounded-full py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          value === "expense"
            ? "bg-rz-red text-rz-bg"
            : "text-rz-muted active:bg-rz-card"
        }`}
      >
        − รายจ่าย
      </button>
    </div>
  );
}
