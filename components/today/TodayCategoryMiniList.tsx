"use client";

import { formatMoney } from "@/lib/money";
import type { TodayCategoryGroup } from "@/lib/today-category-groups";

export function TodayCategoryMiniList({
  groups,
  currency = "THB",
}: {
  groups: TodayCategoryGroup[];
  currency?: string;
}) {
  if (groups.length === 0) return null;

  function scrollToCategory(key: string) {
    const el = document.querySelector(`[data-cat-group="${key}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <section className="mt-3 px-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => scrollToCategory(g.key)}
            className="flex min-h-8 shrink-0 items-center gap-2 rounded-full border-[0.5px] border-rz-border bg-rz-card px-3 py-1.5 active:bg-rz-elevated"
          >
            <span
              className={`text-sm ${g.kind === "income" ? "text-rz-green" : "text-rz-red"}`}
              aria-hidden
            >
              {g.icon}
            </span>
            <span className="text-[11px] text-rz-muted">{g.label}</span>
            <span
              className={`rz-tabular text-[11px] font-medium ${
                g.kind === "income" ? "text-rz-green" : "text-rz-red"
              }`}
            >
              {g.kind === "income" ? "+" : "−"}
              {formatMoney(g.subtotal, currency)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
