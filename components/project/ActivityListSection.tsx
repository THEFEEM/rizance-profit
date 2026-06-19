import Link from "next/link";
import { formatDayShort } from "@/lib/date";
import { formatMoney, moneySign } from "@/lib/money";
import { PROJECT_TYPE_ICON } from "@/lib/project-ui";
import type { ActivitySummary } from "@/types/project";
import { ProjectIconBox } from "@/components/project/icons";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

const ACTIVITY_STATUS_BADGE = {
  active: { label: "กำลังทำ", textClass: "text-rz-green", bgClass: "bg-rz-logo-bg", borderClass: "border-rz-logo-border" },
  closed: { label: "ปิดแล้ว", textClass: "text-rz-muted", bgClass: "bg-rz-elevated", borderClass: "border-rz-border" },
  planning: { label: "วางแผน", textClass: "text-rz-purple", bgClass: "bg-rz-purple-bg", borderClass: "border-rz-purple-border" },
} as const;

function ActivityStatusBadge({ status }: { status: ActivitySummary["status"] }) {
  const cfg = ACTIVITY_STATUS_BADGE[status] ?? ACTIVITY_STATUS_BADGE.active;
  return (
    <span
      className={`shrink-0 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium ${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`}
    >
      {cfg.label}
    </span>
  );
}

export function ActivityListSection({
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
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-rz-muted">กิจกรรมย่อย ({activities.length})</h2>
        <Link
          href={`/projects/${projectId}/activities/new`}
          className="tap-target text-xs font-medium text-rz-purple active:opacity-90"
        >
          ＋ เพิ่มกิจกรรม
        </Link>
      </div>
      <ul className="space-y-2.5">
        {activities.map((act) => {
          const remainSign = moneySign(act.remaining);
          const cfg = PROJECT_TYPE_ICON.short;
          return (
            <li key={act.activityId}>
              <Link
                href={`/projects/${projectId}/activities/${act.activityId}`}
                className="tap-target flex items-center gap-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3.5 active:bg-rz-elevated"
              >
                <ProjectIconBox name={cfg.icon} color={cfg.color} bg={cfg.bg} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-rz-text">{act.name}</p>
                    <ActivityStatusBadge status={act.status} />
                  </div>
                  <p className="mt-1 text-xs rz-tabular text-rz-hint">
                    งบ {formatMoney(act.budgetTarget, currency)}
                    {" · "}
                    <span className={remainSign >= 0 ? "text-rz-green" : "text-rz-red"}>
                      เหลือ {formatMoney(act.remaining, currency)}
                    </span>
                    {" · "}
                    <span className="text-rz-red">ใช้ {formatMoney(act.totalSpent, currency)}</span>
                  </p>
                  {(act.startDate || act.endDate) && (
                    <p className="mt-0.5 text-[11px] text-rz-placeholder">
                      {act.startDate && formatDayShort(act.startDate)}
                      {act.startDate && act.endDate && act.endDate !== act.startDate && ` – ${formatDayShort(act.endDate)}`}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
