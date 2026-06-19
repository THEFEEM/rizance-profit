import { buildExpenseBreakdown, buildIncomeBreakdown } from "@/lib/project-breakdown";
import type { Project, ProjectSummary } from "@/types/project";
import { ProjectBudgetCard } from "@/components/project/ProjectBudgetCard";
import {
  ProjectExpenseBreakdown,
  ProjectIncomeBreakdown,
} from "@/components/project/summary/ProjectBreakdownSections";
import { ProjectSummaryActivityList } from "@/components/project/summary/ProjectSummaryActivityList";
import { ProjectSummaryHeader } from "@/components/project/summary/ProjectSummaryHeader";

/** Long-term project rollup overview — /projects/[id]/summary. */
export function ProjectOverviewView({
  project,
  summary,
  currency = "THB",
  backHref,
}: {
  project: Project;
  summary: ProjectSummary;
  currency?: string;
  backHref: string;
}) {
  const incomeRows = buildIncomeBreakdown(summary.incomeBySource);
  const expenseRows = buildExpenseBreakdown(summary.expenseByCategory);

  return (
    <div className="pb-8" data-context="project">
      <ProjectSummaryHeader project={project} backHref={backHref} />

      <div className="mt-4 space-y-6 px-4">
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
          currency={currency}
          title="ภาพรวมงบทั้งปี"
          fundingLabel="งบที่ได้รับ"
        />

        <ProjectSummaryActivityList
          projectId={project.id}
          activities={summary.activities}
          currency={currency}
        />

        <ProjectIncomeBreakdown rows={incomeRows} currency={currency} title="รวมแหล่งเงินเข้า" />
        <ProjectExpenseBreakdown rows={expenseRows} currency={currency} title="รวมรายจ่ายตามหมวด" />
      </div>
    </div>
  );
}
