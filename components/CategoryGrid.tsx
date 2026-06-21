import type { ReactNode } from "react";

/** Mobile-first one-tap category picker — income/expense entry forms. */
export function CategoryGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
  accent = "green",
}: {
  options: readonly { value: T; label: string; icon: ReactNode; badge?: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  accent?: "green" | "amber" | "rose";
}) {
  const active =
    accent === "rose"
      ? "border-rz-rose bg-rz-rose text-rz-bg"
      : accent === "amber"
        ? "border-rz-amber bg-rz-amber text-rz-bg"
        : "border-rz-green bg-rz-green text-rz-bg";
  const idle =
    "border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated";

  const colClass =
    columns === 4 ? "grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className={`grid gap-2 ${colClass}`} role="radiogroup">
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
            <span className="flex h-6 items-center justify-center" aria-hidden>
              {opt.icon}
            </span>
            <span className="mt-1 text-xs font-medium leading-tight">{opt.label}</span>
            {opt.badge && (
              <span
                className={`mt-0.5 text-[9px] font-normal leading-none ${
                  selected ? "text-rz-bg/70" : "text-rz-hint"
                }`}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
