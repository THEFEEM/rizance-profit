"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { PROJECT_LIST_STATUS_BADGE, projectScopeNoun, projectStatusFullLabel } from "@/lib/project-ui";
import type { Project, ProjectStatus } from "@/types/project";
import { PROJECT_STATUSES } from "@/types/project";
import { ProjectField, ProjectTextArea } from "@/components/project/ProjectField";

export function ProjectSettingsPanel({ project }: { project: Project }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [projectCode, setProjectCode] = useState(project.projectCode ?? "");
  const [orgName, setOrgName] = useState(project.orgName ?? "");
  const [objective, setObjective] = useState(project.objective ?? "");
  const [budgetTarget, setBudgetTarget] = useState(project.budgetTarget);
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [endDate, setEndDate] = useState(project.endDate ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch<Project>(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        projectCode: projectCode || null,
        orgName: orgName || null,
        objective: objective || null,
        budgetTarget: Number(budgetTarget),
        startDate: startDate || null,
        endDate: endDate || null,
        status,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    setError(res.message);
  }

  async function closeProject() {
    if (!confirm(`ปิด${projectScopeNoun(project.projectType)}นี้?`)) return;
    setSaving(true);
    const res = await apiFetch<Project>(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    });
    setSaving(false);
    if (res.ok) router.refresh();
    else setError(res.message);
  }

  return (
    <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap-target flex w-full items-center justify-between px-4 py-3.5 text-sm font-medium text-rz-text"
      >
        ตั้งค่าโครงการ
        <span className="text-rz-hint">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t-[0.5px] border-rz-border px-4 py-4">
          <ProjectField label="ชื่อโครงการ" value={name} onChange={(e) => setName(e.target.value)} />
          <ProjectField
            label="รหัสโครงการ"
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value)}
          />
          <ProjectField label="ชมรม/องค์กร" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <ProjectTextArea label="วัตถุประสงค์" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <ProjectField
            label="งบตั้งต้น (฿)"
            type="number"
            inputMode="decimal"
            value={budgetTarget}
            onChange={(e) => setBudgetTarget(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <ProjectField type="date" label="วันเริ่ม" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <ProjectField type="date" label="วันสิ้นสุด" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div>
            <p className="mb-2 text-xs text-rz-muted">สถานะโครงการ</p>
            <div className="flex flex-wrap gap-2">
              {PROJECT_STATUSES.map((s) => {
                const cfg = PROJECT_LIST_STATUS_BADGE[s];
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
                    {projectStatusFullLabel(s, project.projectType)}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm text-rz-red">{error}</p>}

          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="tap-target w-full rounded-[12px] border-[0.5px] border-rz-purple-border bg-rz-purple-bg py-3 text-sm font-medium text-rz-purple disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
          </button>

          {project.status !== "closed" && (
            <button
              type="button"
              disabled={saving}
              onClick={closeProject}
              className="tap-target w-full rounded-[12px] border-[0.5px] border-rz-border py-3 text-sm font-medium text-rz-muted active:bg-rz-elevated"
            >
              ปิด{projectScopeNoun(project.projectType)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
