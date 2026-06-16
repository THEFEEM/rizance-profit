import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getShortProjectActivity,
  listProjectExpense,
} from "@/lib/project-queries";
import { defaultProjectEntryDate } from "@/lib/date";
import { getCurrentUser } from "@/lib/session";
import { ProjectExpenseForm } from "@/components/project/ProjectExpenseForm";

export const dynamic = "force-dynamic";

export default async function ShortProjectExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project || project.projectType !== "short") notFound();

  const activity = await getShortProjectActivity(user.id, id);
  if (!activity) notFound();

  const entries = await listProjectExpense(user.id, activity.id);
  const closed = project.status === "closed" || activity.status === "closed";
  const startDate = activity.startDate ?? project.startDate;
  const endDate = activity.endDate ?? project.endDate;

  return (
    <ProjectExpenseForm
      projectId={id}
      activityId={activity.id}
      activityName={activity.name}
      startDate={startDate}
      endDate={endDate}
      closed={closed}
      defaultDate={defaultProjectEntryDate(startDate, endDate)}
      entries={entries}
      currency={user.currency}
      backHref={`/projects/${id}`}
    />
  );
}
