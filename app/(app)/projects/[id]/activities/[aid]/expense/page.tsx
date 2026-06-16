import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getProjectActivity,
  listProjectExpense,
} from "@/lib/project-queries";
import { defaultProjectEntryDate } from "@/lib/date";
import { getCurrentUser } from "@/lib/session";
import { ProjectExpenseForm } from "@/components/project/ProjectExpenseForm";

export const dynamic = "force-dynamic";

export default async function ActivityExpensePage({
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

  const entries = await listProjectExpense(user.id, aid);
  const closed = project.status === "closed" || activity.status === "closed";
  const startDate = activity.startDate ?? project.startDate;
  const endDate = activity.endDate ?? project.endDate;

  return (
    <ProjectExpenseForm
      projectId={id}
      activityId={aid}
      activityName={activity.name}
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
