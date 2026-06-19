"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ProjectField, ProjectTextArea } from "@/components/project/ProjectField";

export function CreateActivityForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [chairmanName, setChairmanName] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const res = await apiFetch<{ id: string }>(`/api/projects/${projectId}/activities`, {
      method: "POST",
      body: JSON.stringify({
        name,
        chairmanName: chairmanName || undefined,
        budgetTarget: Number(budgetTarget) || 0,
        startDate,
        endDate,
        note: note || undefined,
      }),
    });

    setSubmitting(false);
    if (res.ok) {
      router.push(`/projects/${projectId}/activities/${res.data.id}`);
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
      <ProjectField
        label="ชื่อโครงการ *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={160}
        required
        error={fieldErrors.name}
      />

      <ProjectField
        label="ชื่อประธานโครงการ"
        value={chairmanName}
        onChange={(e) => setChairmanName(e.target.value)}
        maxLength={160}
        placeholder="ไม่บังคับ"
        error={fieldErrors.chairmanName}
      />

      <ProjectField
        label="งบ (฿)"
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
          label="วันเริ่มต้น *"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          max={endDate || undefined}
          required
          error={fieldErrors.startDate}
        />
        <ProjectField
          label="วันสิ้นสุด *"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          min={startDate || undefined}
          required
          error={fieldErrors.endDate}
        />
      </div>

      <ProjectTextArea
        label="หมายเหตุ"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ไม่บังคับ"
        rows={2}
        error={fieldErrors.note}
      />

      {error && (
        <p className="text-sm text-rz-red" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !name.trim() || !startDate || !endDate}
        className="tap-target rz-btn-primary w-full rounded-[14px] border-[0.5px] border-rz-purple-border bg-rz-purple-bg py-3.5 text-base font-medium text-rz-purple disabled:opacity-50"
      >
        {submitting ? "กำลังสร้าง…" : "เพิ่มโครงการ"}
      </button>
    </form>
  );
}
