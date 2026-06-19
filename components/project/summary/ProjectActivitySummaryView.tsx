import { buildExpenseBreakdown, buildIncomeBreakdown } from "@/lib/project-breakdown";
import type {
  ActivitySummary,
  Project,
  ProjectActivity,
  ProjectExpense,
  ProjectIncome,
} from "@/types/project";
import { ProjectBudgetCard } from "@/components/project/ProjectBudgetCard";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import {
  ProjectExpenseBreakdown,
  ProjectIncomeBreakdown,
} from "@/components/project/summary/ProjectBreakdownSections";
import { ActivitySummaryHeader } from "@/components/project/summary/ProjectSummaryHeader";

/** Activity-level summary — used for /activities/[aid]/summary and short-term /projects/[id]/summary. */
export function ProjectActivitySummaryView({
  project,
  activity,
  summary,
  incomes,
  expenses,
  currency = "THB",
  backHref,
}: {
  project: Project;
  activity: Pick<ProjectActivity, "id" | "name" | "startDate" | "endDate" | "status">;
  summary: ActivitySummary;
  incomes: ProjectIncome[];
  expenses: ProjectExpense[];
  currency?: string;
  backHref: string;
}) {
  const incomeRows = buildIncomeBreakdown(summary.incomeBySource, incomes);
  const expenseRows = buildExpenseBreakdown(summary.expenseByCategory);
  const activityStatus = activity.status === "closed" ? "closed" : "active";

  return (
    <div className="pb-8" data-context="project">
      <ActivitySummaryHeader
        activityName={activity.name}
        projectName={project.name}
        orgName={project.orgName}
        startDate={activity.startDate ?? project.startDate}
        endDate={activity.endDate ?? project.endDate}
        backHref={backHref}
        status={activityStatus}
      />

      <div className="mt-4 space-y-6 px-4">
        <ProjectBudgetCard
          summary={summary}
          currency={currency}
          title="สรุปงบประมาณ"
          fundingLabel="งบที่ได้รับ"
        />

        <ProjectIncomeBreakdown rows={incomeRows} currency={currency} />
        <ProjectExpenseBreakdown rows={expenseRows} currency={currency} />

        <section>
          <h2 className="mb-2.5 text-sm font-medium text-rz-muted">รายการทั้งหมด</h2>
          <ProjectEntryList
            incomes={incomes}
            expenses={expenses}
            currency={currency}
            kind="all"
            limit={0}
          />
        </section>
      </div>
    </div>
  );
}
