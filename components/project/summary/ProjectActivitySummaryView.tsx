import {
  buildFundProgressItems,
  buildOrgExpenseCategoryRows,
  groupProjectExpensesByCategory,
  projectFundingEmoji,
} from "@/lib/project-stats";
import { formatDayShort, formatWeekdayShortThai } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { DailyExpensePoint } from "@/types";
import type {
  ActivitySummary,
  Project,
  ProjectActivity,
  ProjectExpense,
  ProjectIncome,
} from "@/types/project";
import { StatsSummaryCards } from "@/components/stats/StatsSummaryCards";
import { DailyProfitChart } from "@/components/stats/DailyProfitChart";
import { BreakdownSection, ProgressBarRow } from "@/components/stats/BreakdownSection";
import { CategoryProgressList } from "@/components/stats/CategoryProgressList";
import { ProjectEntryList } from "@/components/project/ProjectEntryList";
import { ActivitySummaryHeader } from "@/components/project/summary/ProjectSummaryHeader";
import { ProjectAdvanceCreditorsSection } from "@/components/project/summary/ProjectAdvanceCreditorsSection";

function chartDataFromSeries(series: DailyExpensePoint[], useWeekdayLabels: boolean) {
  return series.map((p) => ({
    date: p.date,
    label: useWeekdayLabels ? formatWeekdayShortThai(p.date) : formatDayShort(p.date),
    expense: Number(p.expense),
    expenseDisplay: p.expense,
  }));
}

/** Activity-level summary — used for /activities/[aid]/summary and short-term /projects/[id]/summary. */
export function ProjectActivitySummaryView({
  project,
  activity,
  summary,
  incomes,
  expenses,
  dailySeries,
  currency = "THB",
  backHref,
}: {
  project: Project;
  activity: Pick<ProjectActivity, "id" | "name" | "startDate" | "endDate" | "status">;
  summary: ActivitySummary;
  incomes: ProjectIncome[];
  expenses: ProjectExpense[];
  dailySeries: DailyExpensePoint[];
  currency?: string;
  backHref: string;
}) {
  const fundRows = buildFundProgressItems(summary.fundBreakdown);
  const categoryRows = buildOrgExpenseCategoryRows(expenses, summary.totalSpent);
  const categoryEntries = groupProjectExpensesByCategory(expenses);
  const activityStatus = activity.status === "closed" ? "closed" : "active";
  const entryTotal = summary.incomeCount + summary.expenseCount;
  const useWeekdayLabels = dailySeries.length > 0 && dailySeries.length <= 7;

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

      <div className="mt-4">
        <StatsSummaryCards
          variant="budget"
          income={summary.totalFunding}
          expense={summary.totalSpent}
          remaining={summary.remaining}
          budgetUsedPct={summary.budgetUsedPct}
          currency={currency}
          accent="purple"
        />
        <p className="px-4 pt-2 text-center text-xs text-rz-hint">
          {entryTotal > 0
            ? `${entryTotal.toLocaleString()} รายการทั้งกิจกรรม`
            : "ยังไม่มีรายการในกิจกรรมนี้"}
          {summary.isOverBudget && (
            <span className="text-rz-red"> · เกินงบ!</span>
          )}
        </p>
      </div>

      <section className="mt-6 px-4">
        <h2 className="mb-2.5 text-sm font-medium text-rz-text">รายจ่ายรายวัน</h2>
        <div className="rounded-[14px] border-[0.5px] border-rz-border bg-rz-card p-3">
          <DailyProfitChart
            data={chartDataFromSeries(dailySeries, useWeekdayLabels)}
            currency={currency}
            mode="expense"
          />
        </div>
      </section>

      <ProjectAdvanceCreditorsSection
        advanceByPayer={summary.advanceByPayer}
        currency={currency}
      />

      <div className="mt-6 space-y-6">
        {fundRows.length > 0 && (
          <BreakdownSection title="ตามแหล่งเงิน">
            <div className="divide-y divide-rz-border">
              {fundRows.map((f) => (
                <ProgressBarRow
                  key={f.sourceKey}
                  icon={projectFundingEmoji(f.sourceKey)}
                  label={f.sourceLabel}
                  amount={`${formatMoney(f.totalSpent, currency)} / ${formatMoney(f.totalReceived, currency)}`}
                  percentage={f.percentage}
                  tone="purple"
                />
              ))}
            </div>
          </BreakdownSection>
        )}

        {categoryRows.length > 0 && (
          <BreakdownSection title="ตามหมวด">
            <CategoryProgressList
              rows={categoryRows}
              entriesByCategory={categoryEntries}
              currency={currency}
              tone="expense"
            />
          </BreakdownSection>
        )}
      </div>

      <section className="mt-6 px-4">
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
  );
}
