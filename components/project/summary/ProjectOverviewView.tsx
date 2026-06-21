import {
  buildActivityProgressItems,
  buildFundProgressItems,
  buildOrgExpenseCategoryRows,
  groupProjectExpensesByCategory,
  projectFundingEmoji,
} from "@/lib/project-stats";
import { formatDayShort, formatWeekdayShortThai } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { DailyExpensePoint } from "@/types";
import type { Project, ProjectExpense, ProjectSummary } from "@/types/project";
import { StatsSummaryCards } from "@/components/stats/StatsSummaryCards";
import { DailyProfitChart } from "@/components/stats/DailyProfitChart";
import { BreakdownSection, ProgressBarRow } from "@/components/stats/BreakdownSection";
import { CategoryProgressList } from "@/components/stats/CategoryProgressList";
import { ProjectSummaryHeader } from "@/components/project/summary/ProjectSummaryHeader";
import { ProjectAdvanceCreditorsSection } from "@/components/project/summary/ProjectAdvanceCreditorsSection";

function chartDataFromSeries(series: DailyExpensePoint[], useWeekdayLabels: boolean) {
  return series.map((p) => ({
    date: p.date,
    label: useWeekdayLabels ? formatWeekdayShortThai(p.date) : formatDayShort(p.date),
    expense: Number(p.expense),
    expenseDisplay: p.expense,
  }));
}

function rollupAdvanceByPayer(
  activities: { advanceByPayer: { payerName: string; unreimbursed: string }[] }[],
) {
  const map = new Map<string, number>();
  for (const activity of activities) {
    for (const p of activity.advanceByPayer) {
      const cents = Math.round(Number(p.unreimbursed) * 100);
      if (cents <= 0) continue;
      map.set(p.payerName, (map.get(p.payerName) ?? 0) + cents);
    }
  }
  return [...map.entries()].map(([payerName, cents]) => ({
    payerName,
    unreimbursed: (cents / 100).toFixed(2),
  }));
}

/** Long-term project rollup overview — /projects/[id]/summary. */
export function ProjectOverviewView({
  project,
  summary,
  dailySeries,
  expenses,
  currency = "THB",
  backHref,
}: {
  project: Project;
  summary: ProjectSummary;
  dailySeries: DailyExpensePoint[];
  expenses: ProjectExpense[];
  currency?: string;
  backHref: string;
}) {
  const fundRows = buildFundProgressItems(summary.fundBreakdown);
  const activityRows = buildActivityProgressItems(summary.activities);
  const categoryRows = buildOrgExpenseCategoryRows(expenses, summary.totalSpent);
  const categoryEntries = groupProjectExpensesByCategory(expenses);
  const entryTotal = summary.activities.reduce((n, a) => n + a.expenseCount, 0);

  const useWeekdayLabels = dailySeries.length > 0 && dailySeries.length <= 7;

  return (
    <div className="pb-8" data-context="project">
      <ProjectSummaryHeader project={project} backHref={backHref} />

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
            ? `${entryTotal.toLocaleString()} รายการทั้งโครงการ`
            : "ยังไม่มีรายการในโครงการนี้"}
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
        advanceByPayer={rollupAdvanceByPayer(summary.activities)}
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

        {activityRows.length > 0 && (
          <BreakdownSection title="ตามโครงการ">
            <div className="divide-y divide-rz-border">
              {activityRows.map((a) => (
                <ProgressBarRow
                  key={a.activityId}
                  icon="📁"
                  label={a.name}
                  amount={`${formatMoney(a.totalSpent, currency)} / ${formatMoney(a.budgetTarget, currency)}`}
                  percentage={a.percentage}
                  tone="red"
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
    </div>
  );
}
