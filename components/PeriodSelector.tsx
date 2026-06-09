"use client";

import Link from "next/link";
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from "@/lib/date";

export function PeriodSelector({
  period,
  date,
}: {
  period: PeriodKey;
  date: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {PERIOD_KEYS.map((key) => {
        const active = key === period;
        const qs = new URLSearchParams({ period: key, date });
        return (
          <Link
            key={key}
            href={`/summary?${qs}`}
            className={`tap-target shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              active
                ? "bg-emerald-700 text-white"
                : "bg-white text-slate-600 shadow-sm ring-1 ring-slate-200"
            }`}
          >
            {PERIOD_LABELS[key]}
          </Link>
        );
      })}
    </div>
  );
}
