// Mirrors lib/project-summary.ts pure compute for Node test scripts (keep in sync).
import {
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
} from "./project-categories-core.mjs";

function toCents(value) {
  const s = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(fracPadded);
  return negative ? -cents : cents;
}

function centsToDecimalString(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function sumDecimals(...values) {
  const total = values.reduce((acc, v) => acc + toCents(v), 0);
  return centsToDecimalString(total);
}

export function computeProfit(income, expense) {
  return centsToDecimalString(toCents(income) - toCents(expense));
}

export function emptyIncomeBySource() {
  return Object.fromEntries(PROJECT_FUNDING_KEYS.map((k) => [k, "0.00"]));
}

export function emptyExpenseByCategory() {
  return Object.fromEntries(PROJECT_EXPENSE_KEYS.map((k) => [k, "0.00"]));
}

export function budgetUsedPct(budgetTarget, totalSpent) {
  const budgetCents = toCents(budgetTarget);
  if (budgetCents <= 0) return 0;
  return Math.round((toCents(totalSpent) / budgetCents) * 10000) / 100;
}

export function computeIsOverBudget(budgetTarget, totalSpent) {
  return toCents(budgetTarget) > 0 && toCents(totalSpent) > toCents(budgetTarget);
}

export function buildActivitySummary(activity, incomes, expenses) {
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
    status: activity.status,
    startDate: activity.start_date,
    endDate: activity.end_date,
  };
}

function rollupCategoryMaps(activities, pick, keys) {
  const out = Object.fromEntries(keys.map((k) => [k, "0.00"]));
  for (const activity of activities) {
    const map = pick(activity);
    for (const key of keys) {
      out[key] = sumDecimals(out[key], map[key] ?? "0.00");
    }
  }
  return out;
}

export function buildProjectSummary(project, activities, incomes, expenses) {
  const activitySummaries = activities.map((a) => buildActivitySummary(a, incomes, expenses));
  const totalBudgetTarget = sumDecimals(...activities.map((a) => a.budget_target));
  const totalFunding = sumDecimals(...activitySummaries.map((a) => a.totalFunding));
  const totalSpent = sumDecimals(...activitySummaries.map((a) => a.totalSpent));

  return {
    projectId: project.id,
    name: project.name,
    projectType: project.project_type,
    orgName: project.org_name,
    status: project.status,
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

export async function loadProjectBundle(client, userId, projectId) {
  const { rows: projectRows } = await client.query(
    `SELECT id, name, project_type, org_name, start_date::text AS start_date,
            end_date::text AS end_date, status
     FROM projects WHERE user_id = $1 AND id = $2`,
    [userId, projectId],
  );
  const project = projectRows[0];
  if (!project) return null;

  const activitiesRes = await client.query(
    `SELECT id, project_id, name, budget_target, start_date::text AS start_date,
            end_date::text AS end_date, status, sort_order
     FROM project_activities
     WHERE user_id = $1 AND project_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [userId, projectId],
  );
  const incomesRes = await client.query(
    `SELECT i.activity_id, i.source, i.amount
     FROM project_income_entries i
     JOIN project_activities a ON a.id = i.activity_id
     WHERE a.project_id = $1 AND a.user_id = $2 AND i.user_id = $2`,
    [projectId, userId],
  );
  const expensesRes = await client.query(
    `SELECT e.activity_id, e.category, e.amount
     FROM project_expense_entries e
     JOIN project_activities a ON a.id = e.activity_id
     WHERE a.project_id = $1 AND a.user_id = $2 AND e.user_id = $2`,
    [projectId, userId],
  );

  return {
    project,
    activities: activitiesRes.rows,
    incomes: incomesRes.rows,
    expenses: expensesRes.rows,
  };
}
