import Link from "next/link";
import { formatDayShort } from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import type { ActivitySummary } from "@/types/project";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

export function ProjectSummaryActivityList({
  projectId,
  activities,
  currency = "THB",
}: {
  projectId: string;
  activities: ActivitySummary[];
  currency?: string;
}) {
  return (
    <section>
      <h2 className="mb-2.5 text-sm font-medium text-rz-muted">กิจกรรมย่อย ({activities.length})</h2>
      <ul className="space-y-2.5">
        {activities.map((act) => {
          const remainSign = moneySign(act.remaining);
          const pct = Math.min(100, Math.max(0, act.budgetUsedPct));
          const status = act.status === "closed" ? "closed" : "active";

          return (
            <li key={act.activityId}>
              <Link
                href={`/projects/${projectId}/activities/${act.activityId}/summary`}
                className="tap-target block rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-rz-text">{act.name}</p>
                  <ProjectStatusBadge status={status} />
                </div>

                {Number(act.budgetTarget) > 0 && (
                  <div className="mt-2.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-rz-elevated">
                      <div
                        className={`h-full rounded-full ${act.isOverBudget ? "bg-rz-red" : "bg-rz-purple"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}

                <p className="mt-2 text-xs rz-tabular text-rz-hint">
                  งบ {formatMoney(act.budgetTarget, currency)}
                  {" · "}
                  <span className="text-rz-red">ใช้ {formatMoney(act.totalSpent, currency)}</span>
                  {" · "}
                  <span className={remainSign >= 0 ? "text-rz-green" : "text-rz-red"}>
                    เหลือ {formatMoney(act.remaining, currency)}
                  </span>
                </p>

                {(act.startDate || act.endDate) && (
                  <p className="mt-0.5 text-[11px] text-rz-placeholder">
                    {act.startDate && formatDayShort(act.startDate)}
                    {act.startDate && act.endDate && act.endDate !== act.startDate &&
                      ` – ${formatDayShort(act.endDate)}`}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
