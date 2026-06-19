import { cookies } from "next/headers";
import { CONTEXT_COOKIE, resolveTodayContext } from "@/lib/context";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import type { Project } from "@/types/project";

/** ModeSwitcher for /projects/* — highlights project tab; uses cookie org context when set. */
export async function ProjectModeSwitcher({
  userId,
  project,
}: {
  userId: string;
  project?: Project;
}) {
  const raw = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const ctx = await resolveTodayContext(userId, undefined, raw);

  return (
    <ModeSwitcher
      mode={ctx.mode}
      forceProjectTab
      boothId={ctx.mode === "booth" ? ctx.boothId : undefined}
      boothName={ctx.mode === "booth" ? ctx.booth.name : undefined}
      boothStartDate={ctx.mode === "booth" ? ctx.booth.startDate : undefined}
      boothEndDate={ctx.mode === "booth" ? ctx.booth.endDate : undefined}
      projectId={ctx.mode === "project" ? ctx.projectId : project?.id}
      projectName={ctx.mode === "project" ? ctx.project.name : project?.name}
      orgName={ctx.mode === "project" ? ctx.project.orgName : project?.orgName}
      projectStartDate={
        ctx.mode === "project" ? ctx.project.startDate : project?.startDate
      }
      projectEndDate={ctx.mode === "project" ? ctx.project.endDate : project?.endDate}
    />
  );
}
