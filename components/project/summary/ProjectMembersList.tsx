import {
  PROJECT_MEMBER_ROLE_LABELS,
  type ProjectMember,
  type ProjectMemberRole,
} from "@/types/project";

const ROLE_BADGE: Record<ProjectMemberRole, { textClass: string; bgClass: string; borderClass: string }> = {
  treasurer: { textClass: "text-rz-blue", bgClass: "bg-[#15293F]", borderClass: "border-[#1E3A52]" },
  member: { textClass: "text-rz-green", bgClass: "bg-rz-logo-bg", borderClass: "border-rz-logo-border" },
  advisor: { textClass: "text-rz-amber", bgClass: "bg-[#2E2310]", borderClass: "border-[#5A3F12]" },
};

export function ProjectMembersList({
  members,
  title = "สมาชิก",
}: {
  members: ProjectMember[];
  title?: string;
}) {
  if (members.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2.5 text-sm font-medium text-rz-muted">
        {title} ({members.length})
      </h2>
      <ul className="divide-y divide-rz-border rounded-[12px] border-[0.5px] border-rz-border bg-rz-card">
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
    </section>
  );
}
