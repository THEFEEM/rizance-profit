"use client";

import Link from "next/link";
import { addDays, type PeriodKey } from "@/lib/date";

function summaryHref(period: PeriodKey, targetDate: string) {
  const qs = new URLSearchParams({ period, date: targetDate });
  return `/summary?${qs}`;
}

export function DateNav({
  date,
  label,
  period,
  maxDate,
}: {
  date: string;
  label: string;
  /** Preserved in URL when changing close-out date. */
  period: PeriodKey;
  /** If set, forward navigation is disabled when date >= maxDate. */
  maxDate?: string;
}) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const canGoNext = maxDate === undefined || next <= maxDate;

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <Link
        href={summaryHref(period, prev)}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-slate-600 active:bg-slate-100"
        aria-label="Previous day"
      >
        ◀
      </Link>
      <p className="min-w-0 flex-1 text-center text-base font-semibold text-slate-900">{label}</p>
      {canGoNext ? (
        <Link
          href={summaryHref(period, next)}
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
