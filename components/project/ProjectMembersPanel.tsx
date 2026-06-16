"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  PROJECT_MEMBER_ROLE_LABELS,
  PROJECT_MEMBER_ROLES,
  type ProjectMember,
  type ProjectMemberRole,
} from "@/types/project";
import { ProjectField } from "@/components/project/ProjectField";

const ROLE_BADGE: Record<ProjectMemberRole, { textClass: string; bgClass: string; borderClass: string }> = {
  treasurer: { textClass: "text-rz-blue", bgClass: "bg-[#15293F]", borderClass: "border-[#1E3A52]" },
  member: { textClass: "text-rz-green", bgClass: "bg-rz-logo-bg", borderClass: "border-rz-logo-border" },
  advisor: { textClass: "text-rz-amber", bgClass: "bg-[#2E2310]", borderClass: "border-[#5A3F12]" },
};

export function ProjectMembersPanel({
  projectId,
  members: initialMembers,
}: {
  projectId: string;
  members: ProjectMember[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState("");
  const [role, setRole] = useState<ProjectMemberRole>("member");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setError(null);
    const res = await apiFetch<ProjectMember>(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), role }),
    });
    setAdding(false);
    if (res.ok) {
      setMembers((prev) => [...prev, res.data]);
      setName("");
      router.refresh();
      return;
    }
    setError(res.message);
  }

  return (
    <section>
      <h2 className="mb-2.5 text-sm font-medium text-rz-muted">สมาชิก ({members.length})</h2>

      {members.length > 0 ? (
        <ul className="mb-4 divide-y divide-rz-border rounded-[12px] border-[0.5px] border-rz-border bg-rz-card">
          {members.map((m) => {
            const cfg = ROLE_BADGE[m.role];
            return (
              <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium text-rz-text">{m.name}</span>
                <span
                  className={`shrink-0 rounded-full border-[0.5px] px-2.5 py-0.5 text-[11px] font-medium ${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`}
                >
                  {PROJECT_MEMBER_ROLE_LABELS[m.role]}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-4 text-xs text-rz-hint">ยังไม่มีสมาชิกในรายการ</p>
      )}

      <form onSubmit={addMember} className="space-y-3 rounded-[12px] border-[0.5px] border-rz-border bg-rz-elevated/40 p-4">
        <ProjectField
          label="ชื่อสมาชิก"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="เช่น น้องเอ"
        />
        <div>
          <p className="mb-2 text-xs text-rz-muted">บทบาท</p>
          <div className="flex flex-wrap gap-2">
            {PROJECT_MEMBER_ROLES.map((r) => {
              const cfg = ROLE_BADGE[r];
              const selected = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`tap-target rounded-full border-[0.5px] px-3 py-1.5 text-xs font-medium ${
                    selected
                      ? `${cfg.textClass} ${cfg.bgClass} ${cfg.borderClass}`
                      : "border-rz-border bg-rz-card text-rz-muted"
                  }`}
                >
                  {PROJECT_MEMBER_ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className="text-xs text-rz-red">{error}</p>}
        <button
          type="submit"
          disabled={adding || !name.trim()}
          className="tap-target w-full rounded-[12px] border-[0.5px] border-[#1E3A52] bg-[#15293F] py-2.5 text-sm font-medium text-rz-blue disabled:opacity-50"
        >
          {adding ? "กำลังเพิ่ม…" : "+ เพิ่มสมาชิก"}
        </button>
      </form>
    </section>
  );
}
