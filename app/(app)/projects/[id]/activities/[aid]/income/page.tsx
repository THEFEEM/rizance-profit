import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getProjectActivity,
  listProjectIncome,
} from "@/lib/project-queries";
import { defaultProjectEntryDate } from "@/lib/date";
import { getCurrentUser } from "@/lib/session";
import { ProjectIncomeForm } from "@/components/project/ProjectIncomeForm";

export const dynamic = "force-dynamic";

export default async function ActivityIncomePage({
  params,
}: {
  params: Promise<{ id: string; aid: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id, aid } = await params;

  const [project, activity] = await Promise.all([
    getProject(user.id, id),
    getProjectActivity(user.id, id, aid),
  ]);
  if (!project || !activity) notFound();

  const entries = await listProjectIncome(user.id, aid);
  const closed = project.status === "closed" || activity.status === "closed";
  const startDate = activity.startDate ?? project.startDate;
  const endDate = activity.endDate ?? project.endDate;

  return (
    <ProjectIncomeForm
      projectId={id}
      activityId={aid}
      activityName={activity.name}
      projectType={project.projectType}
      startDate={startDate}
      endDate={endDate}
      closed={closed}
      defaultDate={defaultProjectEntryDate(startDate, endDate)}
      entries={entries}
      currency={user.currency}
      backHref={`/projects/${id}/activities/${aid}`}
    />
  );
}
