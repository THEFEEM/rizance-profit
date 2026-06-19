import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getShortProjectActivity,
  listActivities,
  listProjectIncome,
  listProjectIncomesForProject,
} from "@/lib/project-queries";
import { defaultProjectEntryDate } from "@/lib/date";
import { getCurrentUser } from "@/lib/session";
import { ProjectIncomeForm } from "@/components/project/ProjectIncomeForm";
import { OrgProjectIncomeForm } from "@/components/project/OrgProjectIncomeForm";
import { ProjectBack } from "@/components/project/ProjectBack";

export const dynamic = "force-dynamic";

export default async function ProjectIncomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project) notFound();

  if (project.projectType === "short") {
    const activity = await getShortProjectActivity(user.id, id);
    if (!activity) notFound();

    const entries = await listProjectIncome(user.id, activity.id);
    const closed = project.status === "closed" || activity.status === "closed";
    const startDate = activity.startDate ?? project.startDate;
    const endDate = activity.endDate ?? project.endDate;

    return (
      <ProjectIncomeForm
        projectId={id}
        activityId={activity.id}
        projectType={project.projectType}
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

  const activities = await listActivities(user.id, id);
  const generalActivity = activities.find((a) => a.isGeneral);
  if (!generalActivity) {
    return (
      <div className="px-4 py-8" data-context="project">
        <ProjectBack href={`/projects/${id}`} />
        <p className="mt-6 text-center text-sm text-rz-red">
          ไม่พบกิจกรรมกองกลาง — กรุณาติดต่อผู้ดูแลระบบ
        </p>
      </div>
    );
  }

  const entries = await listProjectIncomesForProject(user.id, id);
  const activityNames = Object.fromEntries(activities.map((a) => [a.id, a.name]));
  const closed = project.status === "closed" || generalActivity.status === "closed";
  const startDate = generalActivity.startDate ?? project.startDate;
  const endDate = generalActivity.endDate ?? project.endDate;

  return (
    <OrgProjectIncomeForm
      projectId={id}
      projectName={project.name}
      generalActivityId={generalActivity.id}
      activityNames={activityNames}
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
