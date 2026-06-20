import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getShortProjectActivity,
  listProjectExpense,
  listProjectExpensesForProject,
  listProjectIncome,
} from "@/lib/project-queries";
import { orgDailyExpenseSeries, summarizeActivity, summarizeProject } from "@/lib/project-summary";
import { getCurrentUser } from "@/lib/session";
import { ProjectActivitySummaryView } from "@/components/project/summary/ProjectActivitySummaryView";
import { ProjectOverviewView } from "@/components/project/summary/ProjectOverviewView";

export const dynamic = "force-dynamic";

export default async function ProjectSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project) notFound();

  if (project.projectType === "short") {
    const activity = await getShortProjectActivity(user.id, id);
    if (!activity) notFound();

    const [summary, incomes, expenses, dailySeries] = await Promise.all([
      summarizeActivity(user.id, id, activity.id),
      listProjectIncome(user.id, activity.id),
      listProjectExpense(user.id, activity.id),
      orgDailyExpenseSeries(user.id, id, activity.id),
    ]);
    if (!summary) notFound();

    return (
      <ProjectActivitySummaryView
        project={project}
        activity={activity}
        summary={summary}
        incomes={incomes}
        expenses={expenses}
        dailySeries={dailySeries}
        currency={user.currency}
        backHref={`/projects/${id}`}
      />
    );
  }

  const [summary, dailySeries, expenses] = await Promise.all([
    summarizeProject(user.id, id),
    orgDailyExpenseSeries(user.id, id),
    listProjectExpensesForProject(user.id, id),
  ]);
  if (!summary) notFound();

  return (
    <ProjectOverviewView
      project={project}
      summary={summary}
      dailySeries={dailySeries}
      expenses={expenses}
      currency={user.currency}
      backHref={`/projects/${id}`}
    />
  );
}
