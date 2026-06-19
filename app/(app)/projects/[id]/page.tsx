import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getProject,
  getShortProjectActivity,
  listProjectExpense,
  listProjectIncome,
} from "@/lib/project-queries";
import { summarizeProject } from "@/lib/project-summary";
import { getCurrentUser } from "@/lib/session";
import { ActivityListSection } from "@/components/project/ActivityListSection";
import { ProjectBack } from "@/components/project/ProjectBack";
import { ProjectBudgetCard } from "@/components/project/ProjectBudgetCard";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import { ProjectInfoHeader } from "@/components/project/ProjectHubParts";
import { ProjectSettingsPanel } from "@/components/project/ProjectSettingsPanel";

export const dynamic = "force-dynamic";

export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await getProject(user.id, id);
  if (!project) notFound();

  const closed = project.status === "closed";

  if (project.projectType === "long") {
    const summary = await summarizeProject(user.id, id);
    if (!summary) notFound();

    return (
      <div className="pb-8" data-context="project">
        <ProjectBack href="/projects" />
        <div className="mt-1">
          <ProjectInfoHeader project={project} />
        </div>

        <div className="mt-6 space-y-6">
          <div className="px-4">
            <ProjectBudgetCard
              summary={{
                budgetTarget: summary.totalBudgetTarget,
                totalFunding: summary.totalFunding,
                paidFunding: summary.paidFunding,
                committedFunding: summary.committedFunding,
                totalSpent: summary.totalSpent,
                paidSpent: summary.paidSpent,
                committedSpent: summary.committedSpent,
                remaining: summary.remaining,
                budgetRemaining: summary.budgetRemaining,
                budgetUsedPct: summary.budgetUsedPct,
                isOverBudget: summary.isOverBudget,
              }}
              currency={user.currency}
              title="ภาพรวมงบทั้งปี"
            />
          </div>

          <div className="space-y-6 px-4">
            <ActivityListSection
              projectId={id}
              activities={summary.activities}
              currency={user.currency}
            />

            <ProjectSettingsPanel project={project} />

            {!closed && (
              <Link
                href={`/projects/${id}/summary`}
                className="tap-target block rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4 text-center text-sm font-medium text-rz-purple active:bg-rz-elevated"
              >
                ดูสรุปองค์กรเต็ม →
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Short-term: single-activity hub (Option A)
  const activity = await getShortProjectActivity(user.id, id);
  if (!activity) notFound();

  const [summary, incomes, expenses] = await Promise.all([
    summarizeProject(user.id, id),
    listProjectIncome(user.id, activity.id),
    listProjectExpense(user.id, activity.id),
  ]);
  const actSummary = summary?.activities[0];
  if (!actSummary) notFound();

  return (
    <div className="pb-8" data-context="project">
      <ProjectBack href="/projects" />
      <div className="mt-1">
        <ProjectInfoHeader project={project} />
      </div>

      <div className="mt-6 space-y-6">
        <div className="px-4">
          <ProjectBudgetCard summary={actSummary} currency={user.currency} />
        </div>

        <div className="px-4">
          <h2 className="mb-2.5 text-sm font-medium text-rz-muted">รายการล่าสุด</h2>
          <ProjectEntryList incomes={incomes} expenses={expenses} currency={user.currency} />
        </div>

        <div className="space-y-6 px-4">
          <ProjectSettingsPanel project={project} />

          <Link
            href={`/projects/${id}/summary`}
            className="tap-target block rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-4 text-center text-sm font-medium text-rz-purple active:bg-rz-elevated"
          >
            ดูสรุปเต็ม →
          </Link>
        </div>
      </div>
    </div>
  );
}
