"use client";

import Link from "next/link";
import { addDays, type PeriodKey } from "@/lib/date";

export function DateNav({
  date,
  label,
  period,
  maxDate,
  minDate,
  basePath = "/summary",
}: {
  date: string;
  label: string;
  /** Preserved in URL when changing close-out date. */
  period: PeriodKey;
  /** If set, forward navigation is disabled when date >= maxDate. */
  maxDate?: string;
  /** If set, backward navigation is disabled when date <= minDate. */
  minDate?: string;
  basePath?: string;
}) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const canGoNext = maxDate === undefined || next <= maxDate;
  const canGoPrev = minDate === undefined || prev >= minDate;

  function href(targetDate: string) {
    const qs = new URLSearchParams({ period, date: targetDate });
    return `${basePath}?${qs}`;
  }

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      {canGoPrev ? (
        <Link
          href={href(prev)}
          className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
          aria-label="Previous day"
        >
          ◀
        </Link>
      ) : (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-200"
          aria-hidden
        >
          ◀
        </span>
      )}
      <p className="min-w-0 flex-1 text-center text-base font-semibold text-slate-900">{label}</p>
      {canGoNext ? (
        <Link
          href={href(next)}
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
