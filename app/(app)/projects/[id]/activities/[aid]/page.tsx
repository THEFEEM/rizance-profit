import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getProjectActivity,
  listProjectExpense,
  listProjectIncome,
} from "@/lib/project-queries";
import { summarizeActivity } from "@/lib/project-summary";
import { getCurrentUser } from "@/lib/session";
import { ActivitySettingsPanel } from "@/components/project/ActivitySettingsPanel";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectBudgetCard } from "@/components/project/ProjectBudgetCard";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import { ProjectHubActions } from "@/components/project/ProjectHubParts";
import { ProjectStatusBadge } from "@/components/project/ProjectStatusBadge";

export const dynamic = "force-dynamic";

export default async function ActivityHubPage({
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

  const closed = activity.status === "closed" || project.status === "closed";

  const [summary, incomes, expenses] = await Promise.all([
    summarizeActivity(user.id, id, aid),
    listProjectIncome(user.id, aid),
    listProjectExpense(user.id, aid),
  ]);
  if (!summary) notFound();

  return (
    <div className="pb-8" data-context="project">
      <ProjectBack href={`/projects/${id}`} />
      <div className="px-4 pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-medium text-rz-text">{activity.name}</h1>
            <p className="mt-0.5 text-xs text-rz-hint">{project.name}</p>
          </div>
          <ProjectStatusBadge status={activity.status === "closed" ? "closed" : "active"} />
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <div className="px-4">
          <ProjectBudgetCard summary={summary} currency={user.currency} />
        </div>

        <ProjectHubActions
          projectId={id}
          activityId={aid}
          scope="activity"
          closed={closed}
        />

        <div className="px-4">
          <h2 className="mb-2.5 text-sm font-medium text-rz-muted">รายการล่าสุด</h2>
          <ProjectEntryList incomes={incomes} expenses={expenses} currency={user.currency} />
        </div>

        <div className="px-4 space-y-4">
          <ActivitySettingsPanel projectId={id} activity={activity} />
          <Link
            href={`/projects/${id}/activities/${aid}/summary`}
            className="tap-target block rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4 text-center text-sm font-medium text-rz-purple active:bg-rz-elevated"
          >
            ดูสรุปกิจกรรม →
          </Link>
        </div>
      </div>
    </div>
  );
}
