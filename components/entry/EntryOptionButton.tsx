/** One-tap option chip for entry forms (booth payment, cost type, payer kind). */
export function EntryOptionButton({
  selected,
  disabled,
  onClick,
  children,
  accent = "green",
  layout = "chip",
  className = "",
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "green" | "amber" | "blue";
  layout?: "chip" | "row";
  className?: string;
}) {
  const active =
    accent === "amber"
      ? "border-rz-amber bg-rz-amber text-rz-bg"
      : accent === "blue"
        ? "border-rz-blue bg-rz-blue text-rz-bg"
        : "border-rz-green bg-rz-green text-rz-bg";
  const idle =
    "border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated";

  const layoutClass =
    layout === "row"
      ? "w-full rounded-[11px] px-4 py-2.5 text-left text-sm font-medium"
      : "rounded-full px-4 text-sm font-medium";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`tap-target border-[0.5px] transition-colors disabled:opacity-50 ${layoutClass} ${
        selected ? active : idle
      } ${className}`}
    >
      {children}
    </button>
  );
}
