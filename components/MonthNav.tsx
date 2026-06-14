"use client";

import Link from "next/link";
import { addMonths } from "@/lib/date";

export function MonthNav({ month, label }: { month: string; label: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <div className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-2 py-1">
      <Link
        href={`/summary/monthly?month=${prev}`}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-medium text-rz-muted active:bg-rz-elevated"
        aria-label="Previous month"
      >
        ◀
      </Link>
      <p className="min-w-0 flex-1 text-center text-base font-medium text-rz-text">{label}</p>
      <Link
        href={`/summary/monthly?month=${next}`}
        className="tap-target flex h-12 w-12 items-center justify-center rounded-full text-xl font-medium text-rz-muted active:bg-rz-elevated"
        aria-label="Next month"
      >
        ▶
      </Link>
    </div>
  );
}
