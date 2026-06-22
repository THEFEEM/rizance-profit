"use client";

export type EntryTab = "income" | "expense" | "transfer";

export function parseEntryTab(
  tab?: string | null,
  options?: { shop?: boolean },
): EntryTab {
  if (options?.shop && tab === "transfer") return "transfer";
  if (tab === "expense") return "expense";
  return "income";
}

export function EntryToggle({
  value,
  onChange,
  disabled = false,
  showTransfer = false,
}: {
  value: EntryTab;
  onChange: (tab: EntryTab) => void;
  disabled?: boolean;
  /** Shop mode only — third tab for cash↔transfer moves. */
  showTransfer?: boolean;
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
        className={`tap-target flex flex-1 items-center justify-center rounded-full py-2.5 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm ${
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
        className={`tap-target flex flex-1 items-center justify-center rounded-full py-2.5 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm ${
          value === "expense"
            ? "bg-rz-red text-rz-bg"
            : "text-rz-muted active:bg-rz-card"
        }`}
      >
        − รายจ่าย
      </button>
      {showTransfer && (
        <button
          type="button"
          role="tab"
          aria-selected={value === "transfer"}
          disabled={disabled}
          onClick={() => onChange("transfer")}
          className={`tap-target flex flex-1 items-center justify-center rounded-full py-2.5 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm ${
            value === "transfer"
              ? "bg-rz-blue text-rz-bg"
              : "text-rz-muted active:bg-rz-card"
          }`}
        >
          ⇄ ย้ายเงิน
        </button>
      )}
    </div>
  );
}
