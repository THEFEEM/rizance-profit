"use client";

import Link from "next/link";
import { addMonths } from "@/lib/date";

export function MonthNav({ month, label }: { month: string; label: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <Link
        href={`/summary/monthly?month=${prev}`}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
        aria-label="Previous month"
      >
        ◀
      </Link>
      <p className="min-w-0 flex-1 text-center text-base font-semibold text-slate-900">{label}</p>
      <Link
        href={`/summary/monthly?month=${next}`}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
        aria-label="Next month"
      >
        ▶
      </Link>
    </div>
  );
}
