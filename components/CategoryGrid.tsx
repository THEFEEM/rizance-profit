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
  // idle: icon จางกว่า label เล็กน้อยให้ตัวที่เลือกเด่นขึ้น · ยังใช้ token เดิมทั้งหมด
  const idle =
    "border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated [&_svg]:text-rz-muted";

  // จำนวนคอลัมน์คงตามที่ผู้เรียกกำหนด — ไม่สลับอัตโนมัติ เพื่อไม่กระทบ layout เดิม
  const colClass =
    columns === 4 ? "grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className={`grid min-w-0 gap-2 ${colClass}`} role="radiogroup">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            // min-h-12 = 48px ≥ 44px touch target · min-w-0 + break-words กัน label ไทยยาวดัน grid ล้น
            // touch-manipulation ตัด double-tap zoom delay · select-none กันไฮไลต์ข้อความตอนกดค้าง
            className={`tap-target flex min-h-12 min-w-0 select-none touch-manipulation flex-col items-center justify-center rounded-[11px] border-[0.5px] px-1 py-2 text-center transition-colors duration-100 ${
              selected ? active : idle
            }`}
          >
            <span className="flex h-6 items-center justify-center" aria-hidden>
              {opt.icon}
            </span>
            <span className="mt-1 line-clamp-2 w-full break-words text-xs font-medium leading-tight">
              {opt.label}
            </span>
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
