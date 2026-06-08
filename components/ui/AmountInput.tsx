import { currencySymbol } from "@/lib/money";

/** Read-only big amount display driven by the custom keypad (not the OS keyboard). */
export function AmountInput({
  value,
  currency = "THB",
  tone = "neutral",
}: {
  value: string;
  currency?: string;
  tone?: "neutral" | "income" | "expense";
}) {
  const toneClass =
    tone === "income" ? "text-emerald-600" : tone === "expense" ? "text-red-600" : "text-slate-900";

  return (
    <div className="flex items-baseline justify-center gap-2 py-4" aria-live="polite">
      <span className="text-3xl font-semibold text-slate-400">{currencySymbol(currency)}</span>
      <span className={`text-6xl font-extrabold tabular-nums tracking-tight ${toneClass}`}>
        {value || "0"}
      </span>
    </div>
  );
}
