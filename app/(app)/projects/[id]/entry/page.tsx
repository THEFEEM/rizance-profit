import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getShortProjectActivity,
  listActivities,
  listProjectExpense,
  listProjectExpensesForProject,
  listProjectIncome,
  listProjectIncomesForProject,
} from "@/lib/project-queries";
import { summarizeProject } from "@/lib/project-summary";
import { defaultProjectEntryDate } from "@/lib/date";
import { getCurrentUser } from "@/lib/session";
import { OrgProjectCombinedEntryForm } from "@/components/project/OrgProjectCombinedEntryForm";
import { ProjectShortCombinedEntryForm } from "@/components/project/ProjectShortCombinedEntryForm";
import type { ActivityPickerOption } from "@/components/project/ProjectActivityPicker";
import { ProjectBack } from "@/components/project/ProjectBack";

export const dynamic = "force-dynamic";

export default async function ProjectEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { tab } = await searchParams;

  const project = await getProject(user.id, id);
  if (!project) notFound();

  if (project.projectType === "short") {
    const activity = await getShortProjectActivity(user.id, id);
    if (!activity) notFound();

    const [incomes, expenses] = await Promise.all([
      listProjectIncome(user.id, activity.id),
      listProjectExpense(user.id, activity.id),
    ]);
    const closed = project.status === "closed" || activity.status === "closed";
    const startDate = activity.startDate ?? project.startDate;
    const endDate = activity.endDate ?? project.endDate;

    return (
      <ProjectShortCombinedEntryForm
        projectId={id}
        activityId={activity.id}
        activityName={activity.name}
        projectType={project.projectType}
        startDate={startDate}
        endDate={endDate}
        closed={closed}
        defaultDate={defaultProjectEntryDate(startDate, endDate)}
        incomes={incomes}
        expenses={expenses}
        currency={user.currency}
        backHref={`/projects/${id}`}
        initialTab={tab}
      />
    );
  }

  const [activities, summary, incomes, expenses] = await Promise.all([
    listActivities(user.id, id),
    summarizeProject(user.id, id),
    listProjectIncomesForProject(user.id, id),
    listProjectExpensesForProject(user.id, id),
  ]);
  if (!summary) notFound();

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

  const isGeneralById = Object.fromEntries(
    activities.map((a) => [a.id, a.isGeneral]),
  );
  const activityOptions: ActivityPickerOption[] = summary.activities.map((act) => ({
    activityId: act.activityId,
    name: act.name,
    status: act.status,
    budgetRemaining: act.budgetRemaining,
    budgetTarget: act.budgetTarget,
    isGeneral: isGeneralById[act.activityId] ?? false,
  }));

  const activityNames = Object.fromEntries(activities.map((a) => [a.id, a.name]));
  const closed = project.status === "closed";
  const startDate = project.startDate;
  const endDate = project.endDate;

  return (
    <OrgProjectCombinedEntryForm
      projectId={id}
      projectName={project.name}
      generalActivityId={generalActivity.id}
      activityOptions={activityOptions}
      activityNames={activityNames}
      fundBreakdown={summary.fundBreakdown}
      startDate={startDate}
      endDate={endDate}
      closed={closed}
      defaultDate={defaultProjectEntryDate(startDate, endDate)}
      incomes={incomes}
      expenses={expenses}
      currency={user.currency}
      backHref={`/projects/${id}`}
      initialTab={tab}
    />
  );
}
