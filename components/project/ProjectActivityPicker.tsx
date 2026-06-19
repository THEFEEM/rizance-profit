"use client";

import { formatMoney } from "@/lib/money";
import type { ProjectStatus } from "@/types/project";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

export type ActivityPickerOption = {
  activityId: string;
  name: string;
  status: ProjectStatus;
  budgetRemaining: string;
  budgetTarget: string;
  isGeneral: boolean;
};

export function ProjectActivityPicker({
  activities,
  generalActivityId,
  selectedActivityId,
  onChange,
  disabled,
  currency = "THB",
}: {
  activities: ActivityPickerOption[];
  generalActivityId: string;
  selectedActivityId: string;
  onChange: (activityId: string) => void;
  disabled?: boolean;
  currency?: string;
}) {
  const regular = activities.filter((a) => !a.isGeneral);

  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="เลือกโครงการ">
      {regular.map((act) => {
        const selected = selectedActivityId === act.activityId;
        return (
          <button
            key={act.activityId}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(act.activityId)}
            className={`tap-target rounded-[12px] border-[0.5px] px-4 py-3 text-left transition-colors disabled:opacity-50 ${
              selected
                ? "border-rz-purple-border bg-rz-purple-bg"
                : "border-rz-border bg-rz-card active:bg-rz-elevated"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={`text-sm font-medium ${selected ? "text-rz-purple" : "text-rz-text"}`}>
                {act.name}
              </p>
              <ProjectStatusBadge
                status={act.status === "closed" ? "closed" : "active"}
              />
            </div>
            <p className="mt-1 text-xs text-rz-hint">
              เหลือ {formatMoney(act.budgetRemaining, currency)}
              {Number(act.budgetTarget) > 0 && ` / งบ ${formatMoney(act.budgetTarget, currency)}`}
            </p>
          </button>
        );
      })}

      <button
        type="button"
        role="radio"
        aria-checked={selectedActivityId === generalActivityId}
        disabled={disabled}
        onClick={() => onChange(generalActivityId)}
        className={`tap-target rounded-[12px] border-[0.5px] px-4 py-3 text-left transition-colors disabled:opacity-50 ${
          selectedActivityId === generalActivityId
            ? "border-rz-purple-border bg-rz-purple-bg"
            : "border-rz-border border-dashed bg-rz-card active:bg-rz-elevated"
        }`}
      >
        <p
          className={`text-sm font-medium ${
            selectedActivityId === generalActivityId ? "text-rz-purple" : "text-rz-text"
          }`}
        >
          ไม่ระบุโครงการ (กองกลาง)
        </p>
        <p className="mt-0.5 text-xs text-rz-hint">รายจ่ายไม่ผูกกับโครงการย่อย</p>
      </button>
    </div>
  );
}
