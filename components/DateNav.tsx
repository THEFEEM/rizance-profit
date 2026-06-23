"use client";

import Link from "next/link";
import { addDays } from "@/lib/date";

export function DateNav({
  date,
  label,
  maxDate,
  minDate,
  basePath = "/summary/monthly",
  accent = "green",
}: {
  date: string;
  label: string;
  maxDate?: string;
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
    return `${basePath}?mode=daily&date=${targetDate}`;
  }

  const navBtn =
    "tap-target flex h-12 w-12 items-center justify-center rounded-full border-[0.5px] border-rz-border bg-rz-card text-xl font-medium transition-colors";
  const navDisabled =
    "flex h-12 w-12 items-center justify-center rounded-full text-xl font-medium text-rz-border";

  return (
    <div className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-2 py-1">
      {canGoPrev ? (
        <Link href={href(prev)} className={`${navBtn} ${activeNav}`} aria-label="วันก่อนหน้า">
          ◀
        </Link>
      ) : (
        <span className={navDisabled} aria-hidden>
          ◀
        </span>
      )}
      <p className="min-w-0 flex-1 text-center text-base font-medium text-rz-text">{label}</p>
      {canGoNext ? (
        <Link href={href(next)} className={`${navBtn} ${activeNav}`} aria-label="วันถัดไป">
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
