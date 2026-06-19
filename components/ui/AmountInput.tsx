import { currencySymbol } from "@/lib/money";

/** Read-only big amount display driven by the custom keypad (not the OS keyboard). */
export function AmountInput({
  value,
  currency = "THB",
  tone = "neutral",
  compact = false,
}: {
  value: string;
  currency?: string;
  tone?: "neutral" | "income" | "expense";
  compact?: boolean;
}) {
  const toneClass =
    tone === "income" ? "text-rz-green" : tone === "expense" ? "text-rz-red" : "text-rz-text";

  return (
    <div
      className={`flex items-baseline justify-center gap-2 ${compact ? "py-2" : "py-4"}`}
      aria-live="polite"
    >
      <span className="text-2xl font-medium text-rz-hint">{currencySymbol(currency)}</span>
      <span className={`rz-tabular text-[48px] font-medium leading-none tracking-[-0.5px] ${toneClass}`}>
        {value || "0"}
      </span>
    </div>
  );
}
