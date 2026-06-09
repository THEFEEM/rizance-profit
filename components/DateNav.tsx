"use client";

import Link from "next/link";
import { addDays } from "@/lib/date";

export function DateNav({
  date,
  label,
  hrefForDate,
  maxDate,
}: {
  date: string;
  label: string;
  /** Build the full href for a calendar day (include other query params as needed). */
  hrefForDate: (date: string) => string;
  /** If set, forward navigation is disabled when date >= maxDate. */
  maxDate?: string;
}) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const canGoNext = maxDate === undefined || next <= maxDate;

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <Link
        href={hrefForDate(prev)}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
        aria-label="Previous day"
      >
        ◀
      </Link>
      <p className="min-w-0 flex-1 text-center text-base font-semibold text-slate-900">{label}</p>
      {canGoNext ? (
        <Link
          href={hrefForDate(next)}
          className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
          aria-label="Next day"
        >
          ▶
        </Link>
      ) : (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-200"
          aria-hidden
        >
          ▶
        </span>
      )}
    </div>
  );
}
