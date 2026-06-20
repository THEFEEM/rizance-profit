import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getProjectActivity,
  listProjectExpense,
  listProjectIncome,
} from "@/lib/project-queries";
import { orgDailyExpenseSeries, summarizeActivity } from "@/lib/project-summary";
import { getCurrentUser } from "@/lib/session";
import { ProjectActivitySummaryView } from "@/components/project/summary/ProjectActivitySummaryView";

export const dynamic = "force-dynamic";

export default async function ActivitySummaryPage({
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

  const [summary, incomes, expenses, dailySeries] = await Promise.all([
    summarizeActivity(user.id, id, aid),
    listProjectIncome(user.id, aid),
    listProjectExpense(user.id, aid),
    orgDailyExpenseSeries(user.id, id, aid),
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
      backHref={`/projects/${id}/activities/${aid}`}
    />
  );
}
