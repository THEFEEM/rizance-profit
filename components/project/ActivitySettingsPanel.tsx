"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ProjectActivity } from "@/types/project";
import { ACTIVITY_STATUSES } from "@/lib/project-validation";
import { ProjectField } from "@/components/project/ProjectField";

const ACTIVITY_BADGE = {
  active: { label: "กำลังทำ", textClass: "text-rz-green", bgClass: "bg-rz-logo-bg", borderClass: "border-rz-logo-border" },
  closed: { label: "ปิดแล้ว", textClass: "text-rz-muted", bgClass: "bg-rz-elevated", borderClass: "border-rz-border" },
} as const;

export function ActivitySettingsPanel({
  projectId,
  activity,
}: {
  projectId: string;
  activity: ProjectActivity;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(activity.name);
  const [budgetTarget, setBudgetTarget] = useState(activity.budgetTarget);
  const [startDate, setStartDate] = useState(activity.startDate ?? "");
  const [endDate, setEndDate] = useState(activity.endDate ?? "");
  const [status, setStatus] = useState<"active" | "closed">(
    activity.status === "closed" ? "closed" : "active",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<ProjectActivity>(
      `/api/projects/${projectId}/activities/${activity.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name,
          budgetTarget: Number(budgetTarget),
          startDate: startDate || null,
          endDate: endDate || null,
          status,
        }),
      },
    );
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    setError(res.message);
  }

  return (
    <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-target flex w-full items-center justify-between px-4 py-3.5 text-sm font-medium text-rz-text"
      >
        แก้ไขกิจกรรม
        <span className="text-rz-hint">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t-[0.5px] border-rz-border px-4 py-4">
          <ProjectField label="ชื่อกิจกรรม" value={name} onChange={(e) => setName(e.target.value)} />
          <ProjectField
            label="งบกิจกรรม (฿)"
            type="number"
            value={budgetTarget}
            onChange={(e) => setBudgetTarget(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <ProjectField type="date" label="วันเริ่ม" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <ProjectField type="date" label="วันสิ้นสุด" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_STATUSES.map((s) => {
              const cfg = ACTIVITY_BADGE[s];
              const selected = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`tap-target rounded-full border-[0.5px] px-3 py-1.5 text-xs font-medium ${
                    selected
                      ? `${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`
                      : "border-rz-border bg-rz-elevated text-rz-muted"
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm text-rz-red">{error}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="tap-target w-full rounded-[12px] border-[0.5px] border-rz-purple-border bg-rz-purple-bg py-3 text-sm font-medium text-rz-purple disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      )}
    </div>
  );
}
