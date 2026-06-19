import Link from "next/link";
import {
  listActivities,
  listProjectExpensesForProject,
  listProjectIncomesForProject,
} from "@/lib/project-queries";
import { summarizeProject } from "@/lib/project-summary";
import { orgDisplayName } from "@/lib/project-ui";
import type { Project } from "@/types/project";
import type { User } from "@/types";
import { ActivityListSection } from "@/components/project/ActivityListSection";
import { OrgProjectEntryList } from "@/components/project/OrgProjectEntryList";
import { ProjectBudgetCard } from "@/components/project/ProjectBudgetCard";
import { ProjectHubActions } from "@/components/project/ProjectHubParts";

/** Org-mode Today — budget overview, quick actions, recent entries, activities. */
export async function OrgToday({ user, project }: { user: User; project: Project }) {
  const projectId = project.id;
  const closed = project.status === "closed";
  const displayName = orgDisplayName(project);

  const [summary, activities, incomes, expenses] = await Promise.all([
    summarizeProject(user.id, projectId),
    listActivities(user.id, projectId),
    listProjectIncomesForProject(user.id, projectId),
    listProjectExpensesForProject(user.id, projectId),
  ]);
  if (!summary) return null;

  const generalActivity = activities.find((a) => a.isGeneral);
  const activityNames = Object.fromEntries(activities.map((a) => [a.id, a.name]));

  return (
    <div className="mt-4 space-y-6 pb-3" data-context="project">
      <div className="px-4">
        <h1 className="text-lg font-medium text-rz-text">{displayName}</h1>
        {project.orgName && project.name !== project.orgName && (
          <p className="mt-0.5 truncate text-xs text-rz-blue">{project.name}</p>
        )}
      </div>

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

      <ProjectHubActions projectId={projectId} scope="project" closed={closed} />

      <div className="px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-muted">รายการล่าสุด</h2>
        <OrgProjectEntryList
          incomes={incomes}
          expenses={expenses}
          activityNames={activityNames}
          generalActivityId={generalActivity?.id ?? ""}
          currency={user.currency}
          kind="all"
          limit={10}
        />
      </div>

      <div className="px-4">
        <ActivityListSection
          projectId={projectId}
          activities={summary.activities}
          currency={user.currency}
        />
      </div>

      {!closed && (
        <div className="px-4">
          <Link
            href={`/projects/${projectId}`}
            className="tap-target block rounded-[14px] border-[0.5px] border-rz-border bg-rz-card px-4 py-3 text-center text-sm font-medium text-rz-blue active:bg-rz-elevated"
          >
            เปิดหน้าโครงการเต็ม →
          </Link>
        </div>
      )}
    </div>
  );
}
