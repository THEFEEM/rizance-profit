/** Mobile-first one-tap category picker — regular income/expense forms only. */
export function CategoryGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
  accent = "green",
}: {
  options: readonly { value: T; label: string; icon: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
  accent?: "green" | "amber";
}) {
  const active =
    accent === "amber"
      ? "border-rz-amber bg-rz-amber text-rz-bg"
      : "border-rz-green bg-rz-green text-rz-bg";
  const idle =
    "border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated";

  return (
    <div
      className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}
      role="radiogroup"
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`tap-target flex min-h-12 flex-col items-center justify-center rounded-[11px] border-[0.5px] px-1 py-2 text-center transition-colors ${
              selected ? active : idle
            }`}
          >
            <span className="text-xl leading-none" aria-hidden>
              {opt.icon}
            </span>
            <span className="mt-1 text-xs font-medium leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
