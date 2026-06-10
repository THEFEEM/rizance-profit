/** Mobile-first one-tap category picker — regular income/expense forms only. */
export function CategoryGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
}: {
  options: readonly { value: T; label: string; icon: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
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
            className={`tap-target flex min-h-12 flex-col items-center justify-center rounded-2xl border px-1 py-2 text-center transition-colors ${
              selected
                ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
            }`}
          >
            <span className="text-xl leading-none" aria-hidden>
              {opt.icon}
            </span>
            <span className="mt-1 text-xs font-semibold leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
