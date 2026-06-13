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
  accent = "green",
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
  accent?: "green" | "amber";
}) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const canGoNext = maxDate === undefined || next <= maxDate;
  const canGoPrev = minDate === undefined || prev >= minDate;

  const activeNav =
    accent === "amber"
      ? "text-rz-amber active:bg-rz-elevated"
      : "text-rz-green active:bg-rz-elevated";

  function href(targetDate: string) {
    const qs = new URLSearchParams({ period, date: targetDate });
    return `${basePath}?${qs}`;
  }

  const navBtn =
    "tap-target flex h-12 w-12 items-center justify-center rounded-full border-[0.5px] border-rz-border bg-rz-card text-xl font-medium transition-colors";
  const navDisabled =
    "flex h-12 w-12 items-center justify-center rounded-full text-xl font-medium text-rz-border";

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      {canGoPrev ? (
        <Link href={href(prev)} className={`${navBtn} ${activeNav}`} aria-label="Previous day">
          ◀
        </Link>
      ) : (
        <span className={navDisabled} aria-hidden>
          ◀
        </span>
      )}
      <p className="min-w-0 flex-1 text-center text-base font-medium text-rz-text">{label}</p>
      {canGoNext ? (
        <Link href={href(next)} className={`${navBtn} ${activeNav}`} aria-label="Next day">
          ▶
        </Link>
      ) : (
        <span className={navDisabled} aria-hidden>
          ▶
        </span>
      )}
    </div>
  );
}
