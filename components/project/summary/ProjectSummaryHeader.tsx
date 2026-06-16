import { formatDayShort } from "@/lib/date";
import type { Project } from "@/types/project";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

export function ProjectSummaryHeader({
  project,
  backHref,
}: {
  project: Project;
  backHref: string;
}) {
  return (
    <>
      <ProjectBack href={backHref} />
      <div className="px-4 pb-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-medium text-rz-text">{project.name}</h1>
            <p className="mt-0.5 text-sm text-rz-blue">
              {project.orgName ?? "โครงการ"}
              {(project.startDate || project.endDate) && (
                <>
                  {" · "}
                  {project.startDate && formatDayShort(project.startDate)}
                  {project.startDate && project.endDate && project.endDate !== project.startDate &&
                    ` – ${formatDayShort(project.endDate)}`}
                </>
              )}
            </p>
            {project.projectCode && (
              <p className="mt-0.5 text-xs text-rz-hint">รหัส {project.projectCode}</p>
            )}
          </div>
          <ProjectStatusBadge status={project.status} />
        </div>
      </div>
    </>
  );
}

export function ActivitySummaryHeader({
  activityName,
  projectName,
  orgName,
  startDate,
  endDate,
  backHref,
  status,
}: {
  activityName: string;
  projectName: string;
  orgName: string | null;
  startDate: string | null;
  endDate: string | null;
  backHref: string;
  status: "active" | "closed";
}) {
  return (
    <>
      <ProjectBack href={backHref} />
      <div className="px-4 pb-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-medium text-rz-text">{activityName}</h1>
            <p className="mt-0.5 text-sm text-rz-blue">
              {orgName ?? projectName}
              {(startDate || endDate) && (
                <>
                  {" · "}
                  {startDate && formatDayShort(startDate)}
                  {startDate && endDate && endDate !== startDate && ` – ${formatDayShort(endDate)}`}
                </>
              )}
            </p>
          </div>
          <ProjectStatusBadge status={status} />
        </div>
      </div>
    </>
  );
}
