"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ProjectField } from "@/components/project/ProjectField";

export function CreateActivityForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
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

    const res = await apiFetch<{ id: string }>(`/api/projects/${projectId}/activities`, {
      method: "POST",
      body: JSON.stringify({
        name,
        budgetTarget: Number(budgetTarget) || 0,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
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
        label="ชื่อกิจกรรม *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={160}
        required
        error={fieldErrors.name}
      />

      <ProjectField
        label="งบกิจกรรม (฿)"
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
        {submitting ? "กำลังสร้าง…" : "สร้างกิจกรรม"}
      </button>
    </form>
  );
}
