import Link from "next/link";
import { formatDayShort } from "@/lib/date";
import { PROJECT_TYPE_ICON, PROJECT_TYPE_LABELS } from "@/lib/project-ui";
import type { Project } from "@/types/project";
import { ProjectIconBox } from "@/components/project/icons";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

export function ProjectInfoHeader({ project }: { project: Project }) {
  const cfg = PROJECT_TYPE_ICON[project.projectType];

  return (
    <div className="flex items-start gap-3 px-4">
      <ProjectIconBox name={cfg.icon} color={cfg.color} bg={cfg.bg} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-medium text-rz-text">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="mt-0.5 text-sm text-rz-blue">
          {PROJECT_TYPE_LABELS[project.projectType]}
          {project.orgName && ` · ${project.orgName}`}
        </p>
        {project.projectCode && (
          <p className="mt-0.5 text-xs text-rz-hint">รหัส {project.projectCode}</p>
        )}
        {(project.startDate || project.endDate) && (
          <p className="mt-0.5 text-xs text-rz-hint">
            {project.startDate && formatDayShort(project.startDate)}
            {project.startDate && project.endDate && project.endDate !== project.startDate &&
              ` – ${formatDayShort(project.endDate)}`}
          </p>
        )}
        {project.objective && (
          <p className="mt-2 text-xs leading-relaxed text-rz-muted">{project.objective}</p>
        )}
      </div>
    </div>
  );
}

export function ProjectHubActions({
  projectId,
  activityId,
  closed,
  scope = "activity",
}: {
  projectId: string;
  activityId?: string;
  closed?: boolean;
  scope?: "project" | "activity";
}) {
  if (closed) return null;

  const incomeHref =
    scope === "project"
      ? `/projects/${projectId}/income`
      : `/projects/${projectId}/activities/${activityId}/income`;
  const expenseHref =
    scope === "project"
      ? `/projects/${projectId}/expense`
      : `/projects/${projectId}/activities/${activityId}/expense`;

  return (
    <div className="grid grid-cols-2 gap-3 px-4">
      <Link
        href={incomeHref}
        className="tap-target flex h-14 items-center justify-center rounded-[14px] border-[0.5px] border-rz-logo-border bg-rz-logo-bg text-base font-medium text-rz-green active:opacity-90"
      >
        + เงินเข้า
      </Link>
      <Link
        href={expenseHref}
        className="tap-target flex h-14 items-center justify-center rounded-[14px] border-[0.5px] border-[#5A2028] bg-[#2A1518] text-base font-medium text-rz-red active:opacity-90"
      >
        − รายจ่าย
      </Link>
    </div>
  );
}
