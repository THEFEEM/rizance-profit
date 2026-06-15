// Project mode summary computation — derived totals, never stored.
// Option B: one batched fetch per project (activities + entries), aggregate in JS.
import { pool } from "@/lib/db";
import {
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
} from "@/lib/project-categories";
import { computeProfit, sumDecimals, toCents } from "@/lib/money";
import type {
  ActivitySummary,
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
};

type ExpenseEntryRow = {
  activity_id: string;
  category: string;
  amount: string;
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

export function buildActivitySummary(
  activity: ActivityRow,
  incomes: IncomeEntryRow[],
  expenses: ExpenseEntryRow[],
): ActivitySummary {
  const incomeBySource = emptyIncomeBySource();
  let incomeCount = 0;
  for (const row of incomes) {
    if (row.activity_id !== activity.id) continue;
    incomeCount += 1;
    if (row.source in incomeBySource) {
      incomeBySource[row.source] = sumDecimals(incomeBySource[row.source], row.amount);
    }
  }

  const expenseByCategory = emptyExpenseByCategory();
  let expenseCount = 0;
  for (const row of expenses) {
    if (row.activity_id !== activity.id) continue;
    expenseCount += 1;
    if (row.category in expenseByCategory) {
      expenseByCategory[row.category] = sumDecimals(expenseByCategory[row.category], row.amount);
    }
  }

  const totalFunding = sumDecimals(...Object.values(incomeBySource));
  const totalSpent = sumDecimals(...Object.values(expenseByCategory));
  const budgetTarget = activity.budget_target;

  return {
    activityId: activity.id,
    name: activity.name,
    budgetTarget,
    totalFunding,
    totalSpent,
    remaining: computeProfit(totalFunding, totalSpent),
    budgetRemaining: computeProfit(budgetTarget, totalSpent),
    budgetUsedPct: budgetUsedPct(budgetTarget, totalSpent),
    isOverBudget: computeIsOverBudget(budgetTarget, totalSpent),
    incomeBySource,
    expenseByCategory,
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
  const totalSpent = sumDecimals(...activitySummaries.map((a) => a.totalSpent));

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
    totalSpent,
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
              end_date::text AS end_date, status, sort_order
       FROM project_activities
       WHERE user_id = $1 AND project_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [userId, projectId],
    ),
    pool.query<IncomeEntryRow>(
      `SELECT i.activity_id, i.source, i.amount
       FROM project_income_entries i
       JOIN project_activities a ON a.id = i.activity_id
       WHERE a.project_id = $1 AND a.user_id = $2 AND i.user_id = $2`,
      [projectId, userId],
    ),
    pool.query<ExpenseEntryRow>(
      `SELECT e.activity_id, e.category, e.amount
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
    total_funding: string;
    total_spent: string;
  }>(
    `SELECT p.id, p.name, p.project_type, p.org_name, p.status,
            p.start_date::text AS start_date, p.end_date::text AS end_date,
            COALESCE((
              SELECT SUM(i.amount)
              FROM project_income_entries i
              JOIN project_activities a ON a.id = i.activity_id
              WHERE a.project_id = p.id AND a.user_id = $1 AND i.user_id = $1
            ), 0)::text AS total_funding,
            COALESCE((
              SELECT SUM(e.amount)
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
    totalFunding: r.total_funding,
    totalSpent: r.total_spent,
    remaining: computeProfit(r.total_funding, r.total_spent),
  }));
}
