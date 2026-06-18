// Mirrors lib/project-summary.ts pure compute for Node test scripts (keep in sync).
import {
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
  projectFundingLabel,
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

function buildFundBreakdown(incomeBySource, expenseByFund) {
  const breakdown = [];
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

function rollupFundBreakdown(activities) {
  const received = {};
  const spent = {};
  for (const act of activities) {
    for (const fb of act.fundBreakdown) {
      received[fb.sourceKey] = sumDecimals(received[fb.sourceKey] ?? "0.00", fb.totalReceived);
      spent[fb.sourceKey] = sumDecimals(spent[fb.sourceKey] ?? "0.00", fb.totalSpent);
    }
  }
  const keys = new Set([...Object.keys(received), ...Object.keys(spent)]);
  const breakdown = [];
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

export function buildActivitySummary(activity, incomes, expenses) {
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
  const advanceByPayerMap = new Map();
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
      const payerName = row.payer_name && String(row.payer_name).trim() ? String(row.payer_name).trim() : "ไม่ระบุ";
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
    projectType: project.project_type,
    orgName: project.org_name,
    status: project.status,
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
            end_date::text AS end_date, status, is_general, sort_order
     FROM project_activities
     WHERE user_id = $1 AND project_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [userId, projectId],
  );
  const incomesRes = await client.query(
    `SELECT i.activity_id, i.source, i.amount, i.payment_method, i.payment_status
     FROM project_income_entries i
     JOIN project_activities a ON a.id = i.activity_id
     WHERE a.project_id = $1 AND a.user_id = $2 AND i.user_id = $2`,
    [projectId, userId],
  );
  const expensesRes = await client.query(
    `SELECT e.activity_id, e.category, e.amount, e.is_advance, e.payer_name,
            e.reimbursed_at::text AS reimbursed_at,
            e.payment_status, e.fund_source
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
