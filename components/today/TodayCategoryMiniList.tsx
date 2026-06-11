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
    <section className="mt-4 px-4">
      <h2 className="pb-2 text-sm font-semibold text-slate-500">วันนี้ตามหมวด</h2>
      <ul className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {groups.map((g) => (
          <li key={g.key} className="border-b border-slate-50 last:border-b-0">
            <button
              type="button"
              onClick={() => scrollToCategory(g.key)}
              className="tap-target flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
            >
              <span className="text-xl" aria-hidden>
                {g.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                {g.label}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  g.kind === "income" ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {g.kind === "income" ? "+ " : "− "}
                {formatMoney(g.subtotal, currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
