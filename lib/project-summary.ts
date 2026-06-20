// Project mode summary computation — derived totals, never stored.
// Option B: one batched fetch per project (activities + entries), aggregate in JS.
import { addDays } from "@/lib/date";
import { pool } from "@/lib/db";
import {
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
  projectFundingLabel,
} from "@/lib/project-categories";
import { computeProfit, sumDecimals, toCents } from "@/lib/money";
import type { DailyExpensePoint } from "@/types";
import type {
  ActivitySummary,
  FundBalance,
  ProjectListItem,
  ProjectStatus,
  ProjectSummary,
  ProjectType,
} from "@/types/project";

type ActivityRow = {
  id: string;
  project_id: string;
  name: string;
  budget_target: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  is_general: boolean;
  sort_order: number;
};

type ProjectRow = {
  id: string;
  name: string;
  project_type: string;
  org_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
};

type IncomeEntryRow = {
  activity_id: string;
  source: string;
  amount: string;
  payment_method: string;
  payment_status: string;
};

type ExpenseEntryRow = {
  activity_id: string;
  category: string;
  amount: string;
  is_advance: boolean;
  payer_name: string | null;
  reimbursed_at: string | null;
  payment_status: string;
  fund_source: string | null;
};

export function emptyIncomeBySource(): Record<string, string> {
  return Object.fromEntries(PROJECT_FUNDING_KEYS.map((k) => [k, "0.00"]));
}

export function emptyExpenseByCategory(): Record<string, string> {
  return Object.fromEntries(PROJECT_EXPENSE_KEYS.map((k) => [k, "0.00"]));
}

export function budgetUsedPct(budgetTarget: string, totalSpent: string): number {
  const budgetCents = toCents(budgetTarget);
  if (budgetCents <= 0) return 0;
  return Math.round((toCents(totalSpent) / budgetCents) * 10000) / 100;
}

export function computeIsOverBudget(budgetTarget: string, totalSpent: string): boolean {
  return toCents(budgetTarget) > 0 && toCents(totalSpent) > toCents(budgetTarget);
}

function buildFundBreakdown(
  incomeBySource: Record<string, string>,
  expenseByFund: Record<string, string>,
): FundBalance[] {
  const breakdown: FundBalance[] = [];
  for (const key of PROJECT_FUNDING_KEYS) {
    const totalReceived = incomeBySource[key] ?? "0.00";
    const totalSpent = expenseByFund[key] ?? "0.00";
    if (toCents(totalReceived) <= 0 && toCents(totalSpent) <= 0) continue;
    const remaining = computeProfit(totalReceived, totalSpent);
    breakdown.push({
      sourceKey: key,
      sourceLabel: projectFundingLabel(key),
      totalReceived,
      totalSpent,
      remaining,
      isOverspent: toCents(totalSpent) > toCents(totalReceived),
    });
  }
  return breakdown;
}

function rollupFundBreakdown(activities: ActivitySummary[]): FundBalance[] {
  const received: Record<string, string> = {};
  const spent: Record<string, string> = {};
  for (const act of activities) {
    for (const fb of act.fundBreakdown) {
      received[fb.sourceKey] = sumDecimals(received[fb.sourceKey] ?? "0.00", fb.totalReceived);
      spent[fb.sourceKey] = sumDecimals(spent[fb.sourceKey] ?? "0.00", fb.totalSpent);
    }
  }
  const keys = new Set([...Object.keys(received), ...Object.keys(spent)]);
  const breakdown: FundBalance[] = [];
  for (const key of keys) {
    const totalReceived = received[key] ?? "0.00";
    const totalSpent = spent[key] ?? "0.00";
    if (toCents(totalReceived) <= 0 && toCents(totalSpent) <= 0) continue;
    const remaining = computeProfit(totalReceived, totalSpent);
    breakdown.push({
      sourceKey: key,
      sourceLabel: projectFundingLabel(key),
      totalReceived,
      totalSpent,
      remaining,
      isOverspent: toCents(totalSpent) > toCents(totalReceived),
    });
  }
  return breakdown.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

export function buildActivitySummary(
  activity: ActivityRow,
  incomes: IncomeEntryRow[],
  expenses: ExpenseEntryRow[],
): ActivitySummary {
  const incomeBySource = emptyIncomeBySource();
  let incomeCount = 0;
  let paidFunding = "0.00";
  let committedFunding = "0.00";
  let cashFunding = "0.00";
  let transferFunding = "0.00";
  let rejectedFundingCount = 0;

  for (const row of incomes) {
    if (row.activity_id !== activity.id) continue;
    if (row.payment_status === "rejected") {
      rejectedFundingCount += 1;
      continue;
    }
    incomeCount += 1;
    if (row.source in incomeBySource) {
      incomeBySource[row.source] = sumDecimals(incomeBySource[row.source], row.amount);
    }
    if (row.payment_method === "transfer") {
      transferFunding = sumDecimals(transferFunding, row.amount);
    } else {
      cashFunding = sumDecimals(cashFunding, row.amount);
    }
    if (row.payment_status === "paid") {
      paidFunding = sumDecimals(paidFunding, row.amount);
    } else {
      committedFunding = sumDecimals(committedFunding, row.amount);
    }
  }

  const expenseByCategory = emptyExpenseByCategory();
  const expenseByFund = Object.fromEntries(PROJECT_FUNDING_KEYS.map((k) => [k, "0.00"]));
  let unassignedSpent = "0.00";
  let expenseCount = 0;
  let paidSpent = "0.00";
  let committedSpent = "0.00";
  let advanceTotal = "0.00";
  let advanceUnreimbursed = "0.00";
  const advanceByPayerMap = new Map<string, { total: string; unreimbursed: string }>();
  let rejectedExpenseCount = 0;

  for (const row of expenses) {
    if (row.activity_id !== activity.id) continue;
    if (row.payment_status === "rejected") {
      rejectedExpenseCount += 1;
      continue;
    }
    expenseCount += 1;
    if (row.category in expenseByCategory) {
      expenseByCategory[row.category] = sumDecimals(expenseByCategory[row.category], row.amount);
    }
    if (row.is_advance) {
      advanceTotal = sumDecimals(advanceTotal, row.amount);
      const payerName = row.payer_name?.trim() ? row.payer_name.trim() : "ไม่ระบุ";
      const prev = advanceByPayerMap.get(payerName) ?? { total: "0.00", unreimbursed: "0.00" };
      const next = { ...prev, total: sumDecimals(prev.total, row.amount) };
      if (!row.reimbursed_at) {
        advanceUnreimbursed = sumDecimals(advanceUnreimbursed, row.amount);
        next.unreimbursed = sumDecimals(prev.unreimbursed, row.amount);
      }
      advanceByPayerMap.set(payerName, next);
    }
    if (row.fund_source === null) {
      unassignedSpent = sumDecimals(unassignedSpent, row.amount);
    } else if (row.fund_source in expenseByFund) {
      expenseByFund[row.fund_source] = sumDecimals(expenseByFund[row.fund_source], row.amount);
    }
    if (row.payment_status === "paid") {
      paidSpent = sumDecimals(paidSpent, row.amount);
    } else {
      committedSpent = sumDecimals(committedSpent, row.amount);
    }
  }

  const totalFunding = sumDecimals(paidFunding, committedFunding);
  const totalSpent = sumDecimals(paidSpent, committedSpent);
  const budgetTarget = activity.budget_target;

  return {
    activityId: activity.id,
    name: activity.name,
    budgetTarget,
    totalFunding,
    paidFunding,
    committedFunding,
    cashFunding,
    transferFunding,
    rejectedFundingCount,
    totalSpent,
    paidSpent,
    committedSpent,
    advanceTotal,
    advanceUnreimbursed,
    advanceByPayer: Array.from(advanceByPayerMap.entries()).map(([payerName, v]) => ({
      payerName,
      total: v.total,
      unreimbursed: v.unreimbursed,
    })),
    rejectedExpenseCount,
    remaining: computeProfit(totalFunding, totalSpent),
    budgetRemaining: computeProfit(budgetTarget, totalSpent),
    budgetUsedPct: budgetUsedPct(budgetTarget, totalSpent),
    isOverBudget: computeIsOverBudget(budgetTarget, totalSpent),
    incomeBySource,
    expenseByCategory,
    fundBreakdown: buildFundBreakdown(incomeBySource, expenseByFund),
    unassignedSpent,
    incomeCount,
    expenseCount,
    status: activity.status as ProjectStatus,
    startDate: activity.start_date,
    endDate: activity.end_date,
  };
}

function rollupCategoryMaps(
  activities: ActivitySummary[],
  pick: (a: ActivitySummary) => Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const out = Object.fromEntries(keys.map((k) => [k, "0.00"]));
  for (const activity of activities) {
    const map = pick(activity);
    for (const key of keys) {
      out[key] = sumDecimals(out[key], map[key] ?? "0.00");
    }
  }
  return out;
}

export function buildProjectSummary(
  project: ProjectRow,
  activities: ActivityRow[],
  incomes: IncomeEntryRow[],
  expenses: ExpenseEntryRow[],
): ProjectSummary {
  const activitySummaries = activities.map((a) => buildActivitySummary(a, incomes, expenses));
  const totalBudgetTarget = sumDecimals(...activities.map((a) => a.budget_target));
  const totalFunding = sumDecimals(...activitySummaries.map((a) => a.totalFunding));
  const paidFunding = sumDecimals(...activitySummaries.map((a) => a.paidFunding));
  const committedFunding = sumDecimals(...activitySummaries.map((a) => a.committedFunding));
  const rejectedFundingCount = activitySummaries.reduce(
    (sum, a) => sum + a.rejectedFundingCount,
    0,
  );
  const totalSpent = sumDecimals(...activitySummaries.map((a) => a.totalSpent));
  const paidSpent = sumDecimals(...activitySummaries.map((a) => a.paidSpent));
  const committedSpent = sumDecimals(...activitySummaries.map((a) => a.committedSpent));
  const rejectedExpenseCount = activitySummaries.reduce(
    (sum, a) => sum + a.rejectedExpenseCount,
    0,
  );

  return {
    projectId: project.id,
    name: project.name,
    projectType: project.project_type as ProjectType,
    orgName: project.org_name,
    status: project.status as ProjectStatus,
    startDate: project.start_date,
    endDate: project.end_date,
    totalBudgetTarget,
    totalFunding,
    paidFunding,
    committedFunding,
    rejectedFundingCount,
    totalSpent,
    paidSpent,
    committedSpent,
    rejectedExpenseCount,
    remaining: computeProfit(totalFunding, totalSpent),
    budgetRemaining: computeProfit(totalBudgetTarget, totalSpent),
    isOverBudget: computeIsOverBudget(totalBudgetTarget, totalSpent),
    budgetUsedPct: budgetUsedPct(totalBudgetTarget, totalSpent),
    incomeBySource: rollupCategoryMaps(
      activitySummaries,
      (a) => a.incomeBySource,
      PROJECT_FUNDING_KEYS,
    ),
    expenseByCategory: rollupCategoryMaps(
      activitySummaries,
      (a) => a.expenseByCategory,
      PROJECT_EXPENSE_KEYS,
    ),
    fundBreakdown: rollupFundBreakdown(activitySummaries),
    unassignedSpent: sumDecimals(...activitySummaries.map((a) => a.unassignedSpent)),
    activities: activitySummaries,
    activityCount: activitySummaries.length,
    closedActivityCount: activitySummaries.filter((a) => a.status === "closed").length,
  };
}

/** Option B: project + activities + all entries in one Promise.all batch (3 queries). */
async function loadProjectBundle(userId: string, projectId: string) {
  const { rows: projectRows } = await pool.query<ProjectRow>(
    `SELECT id, name, project_type, org_name, start_date::text AS start_date,
            end_date::text AS end_date, status
     FROM projects WHERE user_id = $1 AND id = $2`,
    [userId, projectId],
  );
  const project = projectRows[0];
  if (!project) return null;

  const [activitiesRes, incomesRes, expensesRes] = await Promise.all([
    pool.query<ActivityRow>(
      `SELECT id, project_id, name, budget_target, start_date::text AS start_date,
              end_date::text AS end_date, status, is_general, sort_order
       FROM project_activities
       WHERE user_id = $1 AND project_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [userId, projectId],
    ),
    pool.query<IncomeEntryRow>(
      `SELECT i.activity_id, i.source, i.amount, i.payment_method, i.payment_status
       FROM project_income_entries i
       JOIN project_activities a ON a.id = i.activity_id
       WHERE a.project_id = $1 AND a.user_id = $2 AND i.user_id = $2`,
      [projectId, userId],
    ),
    pool.query<ExpenseEntryRow>(
      `SELECT e.activity_id, e.category, e.amount, e.is_advance, e.payer_name,
              e.reimbursed_at::text AS reimbursed_at,
              e.payment_status, e.fund_source
       FROM project_expense_entries e
       JOIN project_activities a ON a.id = e.activity_id
       WHERE a.project_id = $1 AND a.user_id = $2 AND e.user_id = $2`,
      [projectId, userId],
    ),
  ]);

  return {
    project,
    activities: activitiesRes.rows,
    incomes: incomesRes.rows,
    expenses: expensesRes.rows,
  };
}

export async function summarizeProject(
  userId: string,
  projectId: string,
): Promise<ProjectSummary | null> {
  const bundle = await loadProjectBundle(userId, projectId);
  if (!bundle) return null;
  return buildProjectSummary(
    bundle.project,
    bundle.activities,
    bundle.incomes,
    bundle.expenses,
  );
}

export async function summarizeActivity(
  userId: string,
  projectId: string,
  activityId: string,
): Promise<ActivitySummary | null> {
  const bundle = await loadProjectBundle(userId, projectId);
  if (!bundle) return null;
  const activity = bundle.activities.find((a) => a.id === activityId);
  if (!activity) return null;
  return buildActivitySummary(activity, bundle.incomes, bundle.expenses);
}

export async function listProjectSummaries(userId: string): Promise<ProjectListItem[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    project_type: string;
    org_name: string | null;
    status: string;
    start_date: string | null;
    end_date: string | null;
    activity_count: string;
    total_funding: string;
    total_spent: string;
  }>(
    `SELECT p.id, p.name, p.project_type, p.org_name, p.status,
            p.start_date::text AS start_date, p.end_date::text AS end_date,
            COALESCE((
              SELECT COUNT(*)::int
              FROM project_activities a
              WHERE a.project_id = p.id AND a.user_id = $1
            ), 0)::text AS activity_count,
            COALESCE((
              SELECT SUM(CASE WHEN i.payment_status != 'rejected' THEN i.amount ELSE 0 END)
              FROM project_income_entries i
              JOIN project_activities a ON a.id = i.activity_id
              WHERE a.project_id = p.id AND a.user_id = $1 AND i.user_id = $1
            ), 0)::text AS total_funding,
            COALESCE((
              SELECT SUM(CASE WHEN e.payment_status != 'rejected' THEN e.amount ELSE 0 END)
              FROM project_expense_entries e
              JOIN project_activities a ON a.id = e.activity_id
              WHERE a.project_id = p.id AND a.user_id = $1 AND e.user_id = $1
            ), 0)::text AS total_spent
     FROM projects p
     WHERE p.user_id = $1
     ORDER BY p.status ASC, p.created_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectType: r.project_type as ProjectType,
    orgName: r.org_name,
    status: r.status as ProjectStatus,
    startDate: r.start_date,
    endDate: r.end_date,
    activityCount: Number(r.activity_count),
    totalFunding: r.total_funding,
    totalSpent: r.total_spent,
    remaining: computeProfit(r.total_funding, r.total_spent),
  }));
}

/** Per-day org expense totals — optional activity scope; zero-fills when range ≤ 90 days. */
export async function orgDailyExpenseSeries(
  userId: string,
  projectId: string,
  activityId?: string,
): Promise<DailyExpensePoint[]> {
  const bundle = await loadProjectBundle(userId, projectId);
  if (!bundle) return [];

  const activityFilter = activityId ? "AND e.activity_id = $3" : "";
  const params: (string | undefined)[] = [projectId, userId];
  if (activityId) params.push(activityId);

  const { rows } = await pool.query<{ entry_date: string; expense: string }>(
    `SELECT to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date,
            COALESCE(SUM(e.amount), 0)::text AS expense
     FROM project_expense_entries e
     JOIN project_activities a ON a.id = e.activity_id
     WHERE a.project_id = $1 AND a.user_id = $2 AND e.user_id = $2
       AND e.payment_status != 'rejected'
       ${activityFilter}
     GROUP BY e.entry_date
     ORDER BY entry_date ASC`,
    params,
  );

  if (rows.length === 0) return [];

  const byDate = new Map(rows.map((r) => [r.entry_date, r.expense]));

  let start: string;
  let end: string;

  if (activityId) {
    const act = bundle.activities.find((a) => a.id === activityId);
    start = act?.start_date ?? rows[0].entry_date;
    end = act?.end_date ?? rows[rows.length - 1].entry_date;
  } else {
    start = bundle.project.start_date ?? rows[0].entry_date;
    end = bundle.project.end_date ?? rows[rows.length - 1].entry_date;
  }

  if (start > end) [start, end] = [end, start];

  const dayCount =
    Math.floor(
      (new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;

  if (dayCount > 90) {
    return rows.map((r) => ({ date: r.entry_date, expense: r.expense }));
  }

  const series: DailyExpensePoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    series.push({ date: d, expense: byDate.get(d) ?? "0.00" });
  }
  return series;
}
