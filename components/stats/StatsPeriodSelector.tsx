"use client";

import Link from "next/link";
import { PERIOD_LABELS } from "@/lib/date";

const STATS_PERIODS = ["last_7", "last_30"] as const;
export type StatsPeriodKey = (typeof STATS_PERIODS)[number];

export function StatsPeriodSelector({
  period,
  basePath = "/summary",
  accent = "green",
}: {
  period: StatsPeriodKey;
  basePath?: string;
  accent?: "green" | "rose";
}) {
  const activeClass =
    accent === "rose" ? "bg-rz-rose text-rz-bg" : "bg-rz-green text-rz-bg";

  return (
    <div className="flex justify-end gap-2 px-4 pb-1">
      {STATS_PERIODS.map((key) => {
        const active = key === period;
        return (
          <Link
            key={key}
            href={`${basePath}?period=${key}`}
            className={`tap-target shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? activeClass
                : "border-[0.5px] border-rz-border bg-rz-card text-rz-muted active:bg-rz-elevated"
            }`}
          >
            {PERIOD_LABELS[key]}
          </Link>
        );
      })}
    </div>
  );
}
