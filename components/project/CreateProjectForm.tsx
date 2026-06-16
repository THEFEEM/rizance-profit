"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ProjectType } from "@/types/project";
import { ProjectField, ProjectTextArea } from "@/components/project/ProjectField";
import { ProjectIconBox } from "@/components/project/icons";
import { PROJECT_TYPE_ICON, PROJECT_TYPE_LABELS } from "@/lib/project-ui";

export function CreateProjectForm() {
  const router = useRouter();
  const [projectType, setProjectType] = useState<ProjectType>("short");
  const [name, setName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [objective, setObjective] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const res = await apiFetch<{ id: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        projectType,
        projectCode: projectCode || undefined,
        orgName: orgName || undefined,
        objective: objective || undefined,
        budgetTarget: Number(budgetTarget) || 0,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: "active",
      }),
    });

    setSubmitting(false);
    if (res.ok) {
      router.push(`/projects/${res.data.id}`);
      router.refresh();
      return;
    }

    setError(res.message);
    if (res.fields) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.fields)) {
        if (v?.[0]) next[k] = v[0];
      }
      setFieldErrors(next);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 px-4 pb-8">
      <div>
        <p className="mb-2 text-xs text-rz-muted">ประเภทโครงการ</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ประเภทโครงการ">
          {(["short", "long"] as const).map((type) => {
            const cfg = PROJECT_TYPE_ICON[type];
            const selected = projectType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setProjectType(type)}
                className={`tap-target flex flex-col items-center gap-2 rounded-[12px] border-[0.5px] px-3 py-4 transition-colors ${
                  selected
                    ? "border-[#1E3A52] bg-[#15293F] text-rz-blue"
                    : "border-rz-border bg-rz-card text-rz-text active:bg-rz-elevated"
                }`}
              >
                <ProjectIconBox name={cfg.icon} color={cfg.color} bg={cfg.bg} size={32} />
                <span className="text-sm font-medium">{PROJECT_TYPE_LABELS[type]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ProjectField
        label="ชื่อโครงการ *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={160}
        required
        error={fieldErrors.name}
      />

      <ProjectField
        label="รหัสโครงการ"
        value={projectCode}
        onChange={(e) => setProjectCode(e.target.value)}
        maxLength={40}
        placeholder="ไม่บังคับ"
        error={fieldErrors.projectCode}
      />

      <ProjectField
        label="ชมรม/องค์กร"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        maxLength={160}
        placeholder="ไม่บังคับ"
        error={fieldErrors.orgName}
      />

      <ProjectTextArea
        label="วัตถุประสงค์"
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder="ไม่บังคับ"
        error={fieldErrors.objective}
      />

      <ProjectField
        label="งบตั้งต้น (฿)"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={budgetTarget}
        onChange={(e) => setBudgetTarget(e.target.value)}
        error={fieldErrors.budgetTarget}
      />

      <div className="grid grid-cols-2 gap-3">
        <ProjectField
          label="วันเริ่มต้น"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          max={endDate || undefined}
          error={fieldErrors.startDate}
        />
        <ProjectField
          label="วันสิ้นสุด"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          min={startDate || undefined}
          error={fieldErrors.endDate}
        />
      </div>

      {error && (
        <p className="text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="tap-target rz-btn-primary w-full rounded-[14px] border-[0.5px] border-[#1E3A52] bg-[#15293F] py-3.5 text-base font-medium text-rz-blue disabled:opacity-50"
      >
        {submitting ? "กำลังสร้าง…" : "สร้างโครงการ"}
      </button>
    </form>
  );
}
