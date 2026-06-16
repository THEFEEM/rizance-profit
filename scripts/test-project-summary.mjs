// Project summary canonical cases (a–i) — Option B fetch + JS aggregate.
// Usage: npm run test:project-summary
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pgClientOptions } from "./pg-config.mjs";
import {
  buildProjectSummary,
  loadProjectBundle,
} from "./project-summary-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // skip
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

let failed = 0;
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — expected ${expected}, got ${actual}`}`);
  if (!ok) failed++;
}

function assertNear(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(Number(actual) - Number(expected)) <= tolerance;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — expected ~${expected}, got ${actual}`}`);
  if (!ok) failed++;
}

function assertBool(label, actual, expected) {
  assertEq(label, actual, expected);
}

function fundOf(summary, key) {
  return summary.fundBreakdown.find((f) => f.sourceKey === key);
}

const client = new pg.Client(pgClientOptions(connectionString));
let userA = null;

async function insertShortWithActivity(uid, name, budget) {
  const { rows: p } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, budget_target, start_date, end_date)
     VALUES ($1, $2, 'short', $3, '2026-07-01'::date, '2026-07-03'::date)
     RETURNING id`,
    [uid, name, budget],
  );
  const projectId = p[0].id;
  const { rows: a } = await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, start_date, end_date, sort_order)
     VALUES ($1, $2, $3, $4, '2026-07-01'::date, '2026-07-03'::date, 0)
     RETURNING id`,
    [projectId, uid, name, budget],
  );
  return { projectId, activityId: a[0].id };
}

try {
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'projects'`,
  );
  if (tables.length === 0) {
    console.log("=== PROJECT SUMMARY TEST ===\n");
    console.log("⊘ Skipped — projects table not found.");
    process.exit(0);
  }

  const { rows: fundCol } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_expense_entries'
       AND column_name = 'fund_source'`,
  );
  if (fundCol.length === 0) {
    console.log("=== PROJECT SUMMARY TEST ===\n");
    console.log("⊘ Skipped — fund_source column not found (run migration 0013 first).");
    process.exit(0);
  }

  console.log("=== PROJECT SUMMARY TEST ===\n");
  console.log("Query option: B (batched fetch + JS aggregate)\n");

  const emailA = `proj-sum-a-${Date.now()}@rizance.test`;
  const { rows: usersA } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'proj-sum-test', 'Project Sum Shop') RETURNING id`,
    [emailA],
  );
  userA = usersA[0].id;

  // (a) Short project canonical
  console.log("(a) Short project — funding 30k, spent 24.5k, budget 30k");
  const short = await insertShortWithActivity(userA, "ค่ายรับน้อง", "30000.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date),
            ($1, $2, 10000.00, 'participant_fee', '2026-07-01'::date)`,
    [short.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date)
     VALUES ($1, $2, 9000.00, 'venue', '2026-07-01'::date),
            ($1, $2, 8500.00, 'food', '2026-07-02'::date),
            ($1, $2, 7000.00, 'transport', '2026-07-02'::date)`,
    [short.activityId, userA],
  );
  const bundleA = await loadProjectBundle(client, userA, short.projectId);
  const summaryA = buildProjectSummary(
    bundleA.project,
    bundleA.activities,
    bundleA.incomes,
    bundleA.expenses,
  );
  const actA = summaryA.activities[0];
  assertEq("totalFunding", actA.totalFunding, "30000.00");
  assertEq("totalSpent", actA.totalSpent, "24500.00");
  assertEq("remaining", actA.remaining, "5500.00");
  assertEq("budgetRemaining", actA.budgetRemaining, "5500.00");
  assertBool("isOverBudget", actA.isOverBudget, false);
  assertNear("budgetUsedPct", actA.budgetUsedPct, 81.67);
  assertEq("faculty_grant", actA.incomeBySource.faculty_grant, "20000.00");
  assertEq("participant_fee", actA.incomeBySource.participant_fee, "10000.00");
  assertEq("short activity count", summaryA.activityCount, 1);
  console.log("");

  // (b) Over budget
  console.log("(b) Activity over budget — budget 10k, spent 12k");
  const over = await insertShortWithActivity(userA, "งานเกินงบ", "10000.00");
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date)
     VALUES ($1, $2, 12000.00, 'venue', '2026-07-01'::date)`,
    [over.activityId, userA],
  );
  const bundleB = await loadProjectBundle(client, userA, over.projectId);
  const overAct = buildProjectSummary(
    bundleB.project,
    bundleB.activities,
    bundleB.incomes,
    bundleB.expenses,
  ).activities[0];
  assertBool("isOverBudget", overAct.isOverBudget, true);
  assertEq("budgetRemaining", overAct.budgetRemaining, "-2000.00");
  console.log("");

  // (c) No budget set
  console.log("(c) No budget — budget_target 0");
  const noBudget = await insertShortWithActivity(userA, "ไม่ตั้งงบ", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date)
     VALUES ($1, $2, 5000.00, 'donation', '2026-07-01'::date)`,
    [noBudget.activityId, userA],
  );
  const bundleC = await loadProjectBundle(client, userA, noBudget.projectId);
  const noBudgetAct = buildProjectSummary(
    bundleC.project,
    bundleC.activities,
    bundleC.incomes,
    bundleC.expenses,
  ).activities[0];
  assertEq("budgetUsedPct", noBudgetAct.budgetUsedPct, 0);
  assertBool("isOverBudget", noBudgetAct.isOverBudget, false);
  console.log("");

  // (d) Long project rollup
  console.log("(d) Long project — 2 activities rollup");
  const { rows: longP } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, budget_target, start_date, end_date)
     VALUES ($1, 'งบชมรม ปี 2569', 'long', 120000.00, '2026-01-01'::date, '2026-12-31'::date)
     RETURNING id`,
    [userA],
  );
  const longId = longP[0].id;
  await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, is_general, sort_order)
     VALUES ($1, $2, 'กองกลาง', 0, true, -1)`,
    [longId, userA],
  );
  const { rows: acts } = await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, sort_order)
     VALUES ($1, $2, 'ค่ายรับน้อง', 50000.00, 0),
            ($1, $2, 'งานบวช', 30000.00, 1)
     RETURNING id`,
    [longId, userA],
  );
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2026-03-01'::date),
            ($3, $2, 15000.00, 'membership', '2026-04-01'::date)`,
    [acts[0].id, userA, acts[1].id],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date)
     VALUES ($1, $2, 24500.00, 'venue', '2026-03-01'::date),
            ($3, $2, 13700.00, 'food', '2026-04-01'::date)`,
    [acts[0].id, userA, acts[1].id],
  );
  const bundleD = await loadProjectBundle(client, userA, longId);
  const summaryD = buildProjectSummary(
    bundleD.project,
    bundleD.activities,
    bundleD.incomes,
    bundleD.expenses,
  );
  assertEq("project totalFunding", summaryD.totalFunding, "45000.00");
  assertEq("project totalSpent", summaryD.totalSpent, "38200.00");
  assertEq("project remaining", summaryD.remaining, "6800.00");
  assertEq("rollup faculty_grant", summaryD.incomeBySource.faculty_grant, "30000.00");
  assertEq("rollup membership", summaryD.incomeBySource.membership, "15000.00");
  assertEq("activity count", summaryD.activityCount, 3);
  console.log("");

  // (e) Scope isolation
  console.log("(e) Scope — user B cannot load user A project");
  const { rows: userB } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'x', 'Other') RETURNING id`,
    [`proj-sum-b-${Date.now()}@rizance.test`],
  );
  const otherId = userB[0].id;
  const bundleE = await loadProjectBundle(client, otherId, short.projectId);
  assertEq("user B bundle is null", bundleE, null);
  await client.query(`DELETE FROM users WHERE id = $1`, [otherId]);
  console.log("");

  // (f) Rejected expense not counted
  console.log("(f) Rejected expense not counted");
  const caseF = await insertShortWithActivity(userA, "rejected expense", "30000.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2026-07-01'::date, 'paid')`,
    [caseF.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status)
     VALUES ($1, $2, 9000.00, 'venue', '2026-07-01'::date, 'paid'),
            ($1, $2, 8500.00, 'food', '2026-07-02'::date, 'paid'),
            ($1, $2, 2000.00, 'reward', '2026-07-02'::date, 'rejected')`,
    [caseF.activityId, userA],
  );
  const bundleF = await loadProjectBundle(client, userA, caseF.projectId);
  const actF = buildProjectSummary(
    bundleF.project,
    bundleF.activities,
    bundleF.incomes,
    bundleF.expenses,
  ).activities[0];
  assertEq("totalSpent", actF.totalSpent, "17500.00");
  assertEq("paidSpent", actF.paidSpent, "17500.00");
  assertEq("committedSpent", actF.committedSpent, "0.00");
  assertEq("rejectedExpenseCount", actF.rejectedExpenseCount, 1);
  assertEq("expenseCount", actF.expenseCount, 2);
  assertEq("remaining", actF.remaining, "12500.00");
  console.log("");

  // (g) Rejected income not counted
  console.log("(g) Rejected income not counted");
  const caseG = await insertShortWithActivity(userA, "rejected income", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date, 'paid'),
            ($1, $2, 5000.00, 'sponsor', '2026-07-01'::date, 'rejected')`,
    [caseG.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status)
     VALUES ($1, $2, 10000.00, 'venue', '2026-07-01'::date, 'paid')`,
    [caseG.activityId, userA],
  );
  const bundleG = await loadProjectBundle(client, userA, caseG.projectId);
  const actG = buildProjectSummary(
    bundleG.project,
    bundleG.activities,
    bundleG.incomes,
    bundleG.expenses,
  ).activities[0];
  assertEq("totalFunding", actG.totalFunding, "20000.00");
  assertEq("rejectedFundingCount", actG.rejectedFundingCount, 1);
  assertEq("incomeCount", actG.incomeCount, 1);
  console.log("");

  // (h) Paid vs committed split
  console.log("(h) Paid vs committed split");
  const caseH = await insertShortWithActivity(userA, "paid vs committed", "50000.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2026-07-01'::date, 'paid'),
            ($1, $2, 10000.00, 'participant_fee', '2026-07-01'::date, 'approved'),
            ($1, $2, 5000.00, 'sponsor', '2026-07-01'::date, 'pending')`,
    [caseH.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status)
     VALUES ($1, $2, 10000.00, 'venue', '2026-07-01'::date, 'paid'),
            ($1, $2, 5000.00, 'food', '2026-07-02'::date, 'approved'),
            ($1, $2, 3000.00, 'transport', '2026-07-02'::date, 'pending')`,
    [caseH.activityId, userA],
  );
  const bundleH = await loadProjectBundle(client, userA, caseH.projectId);
  const actH = buildProjectSummary(
    bundleH.project,
    bundleH.activities,
    bundleH.incomes,
    bundleH.expenses,
  ).activities[0];
  assertEq("totalFunding", actH.totalFunding, "45000.00");
  assertEq("paidFunding", actH.paidFunding, "30000.00");
  assertEq("committedFunding", actH.committedFunding, "15000.00");
  assertEq("totalSpent", actH.totalSpent, "18000.00");
  assertEq("paidSpent", actH.paidSpent, "10000.00");
  assertEq("committedSpent", actH.committedSpent, "8000.00");
  assertEq("remaining", actH.remaining, "27000.00");
  assertEq("budgetRemaining", actH.budgetRemaining, "32000.00");
  console.log("");

  // (i) Mixed rejected + committed
  console.log("(i) Mixed rejected + committed");
  const caseI = await insertShortWithActivity(userA, "mixed rejected", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date, 'paid'),
            ($1, $2, 3000.00, 'donation', '2026-07-01'::date, 'rejected')`,
    [caseI.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status)
     VALUES ($1, $2, 5000.00, 'venue', '2026-07-01'::date, 'paid'),
            ($1, $2, 2000.00, 'materials', '2026-07-02'::date, 'approved'),
            ($1, $2, 1000.00, 'printing', '2026-07-02'::date, 'rejected')`,
    [caseI.activityId, userA],
  );
  const bundleI = await loadProjectBundle(client, userA, caseI.projectId);
  const actI = buildProjectSummary(
    bundleI.project,
    bundleI.activities,
    bundleI.incomes,
    bundleI.expenses,
  ).activities[0];
  assertEq("totalFunding", actI.totalFunding, "20000.00");
  assertEq("totalSpent", actI.totalSpent, "7000.00");
  assertEq("remaining", actI.remaining, "13000.00");
  assertEq("rejectedFundingCount", actI.rejectedFundingCount, 1);
  assertEq("rejectedExpenseCount", actI.rejectedExpenseCount, 1);
  assertEq("incomeCount", actI.incomeCount, 1);
  assertEq("expenseCount", actI.expenseCount, 2);
  console.log("");

  // (j) Expense assigned to fund
  console.log("(j) Expense assigned to fund");
  const caseJ = await insertShortWithActivity(userA, "fund assign", "30000.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2026-07-01'::date, 'paid')`,
    [caseJ.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status, fund_source)
     VALUES ($1, $2, 9000.00, 'venue', '2026-07-01'::date, 'paid', 'faculty_grant')`,
    [caseJ.activityId, userA],
  );
  const bundleJ = await loadProjectBundle(client, userA, caseJ.projectId);
  const actJ = buildProjectSummary(
    bundleJ.project,
    bundleJ.activities,
    bundleJ.incomes,
    bundleJ.expenses,
  ).activities[0];
  assertEq("totalSpent", actJ.totalSpent, "9000.00");
  assertEq("unassignedSpent", actJ.unassignedSpent, "0.00");
  assertEq("fundBreakdown count", actJ.fundBreakdown.length, 1);
  const fundJ = fundOf(actJ, "faculty_grant");
  assertEq("faculty totalReceived", fundJ.totalReceived, "30000.00");
  assertEq("faculty totalSpent", fundJ.totalSpent, "9000.00");
  assertEq("faculty remaining", fundJ.remaining, "21000.00");
  assertBool("faculty isOverspent", fundJ.isOverspent, false);
  console.log("");

  // (k) Overspent fund (warning, not blocked)
  console.log("(k) Overspent fund");
  const caseK = await insertShortWithActivity(userA, "overspent fund", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 10000.00, 'sponsor', '2026-07-01'::date, 'paid')`,
    [caseK.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status, fund_source)
     VALUES ($1, $2, 12000.00, 'food', '2026-07-01'::date, 'paid', 'sponsor')`,
    [caseK.activityId, userA],
  );
  const bundleK = await loadProjectBundle(client, userA, caseK.projectId);
  const actK = buildProjectSummary(
    bundleK.project,
    bundleK.activities,
    bundleK.incomes,
    bundleK.expenses,
  ).activities[0];
  assertEq("totalSpent", actK.totalSpent, "12000.00");
  const fundK = fundOf(actK, "sponsor");
  assertEq("sponsor totalReceived", fundK.totalReceived, "10000.00");
  assertEq("sponsor totalSpent", fundK.totalSpent, "12000.00");
  assertEq("sponsor remaining", fundK.remaining, "-2000.00");
  assertBool("sponsor isOverspent", fundK.isOverspent, true);
  console.log("");

  // (l) Multiple funds + unassigned
  console.log("(l) Multiple funds + unassigned (กองกลาง)");
  const caseL = await insertShortWithActivity(userA, "multi fund", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date, 'paid'),
            ($1, $2, 15000.00, 'sponsor', '2026-07-01'::date, 'paid')`,
    [caseL.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status, fund_source)
     VALUES ($1, $2, 9000.00, 'venue', '2026-07-01'::date, 'paid', 'faculty_grant'),
            ($1, $2, 5000.00, 'food', '2026-07-02'::date, 'paid', 'sponsor'),
            ($1, $2, 3000.00, 'transport', '2026-07-02'::date, 'paid', NULL)`,
    [caseL.activityId, userA],
  );
  const bundleL = await loadProjectBundle(client, userA, caseL.projectId);
  const actL = buildProjectSummary(
    bundleL.project,
    bundleL.activities,
    bundleL.incomes,
    bundleL.expenses,
  ).activities[0];
  assertEq("totalSpent", actL.totalSpent, "17000.00");
  assertEq("unassignedSpent", actL.unassignedSpent, "3000.00");
  assertEq("fundBreakdown count", actL.fundBreakdown.length, 2);
  const fundLFaculty = fundOf(actL, "faculty_grant");
  assertEq("faculty received", fundLFaculty.totalReceived, "20000.00");
  assertEq("faculty spent", fundLFaculty.totalSpent, "9000.00");
  assertEq("faculty remaining", fundLFaculty.remaining, "11000.00");
  const fundLSponsor = fundOf(actL, "sponsor");
  assertEq("sponsor received", fundLSponsor.totalReceived, "15000.00");
  assertEq("sponsor spent", fundLSponsor.totalSpent, "5000.00");
  assertEq("sponsor remaining", fundLSponsor.remaining, "10000.00");
  console.log("");

  // (m) Rejected expense not counted in fund
  console.log("(m) Rejected expense not counted in fund");
  const caseM = await insertShortWithActivity(userA, "rejected fund expense", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date, 'paid')`,
    [caseM.activityId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status, fund_source)
     VALUES ($1, $2, 5000.00, 'venue', '2026-07-01'::date, 'paid', 'faculty_grant'),
            ($1, $2, 3000.00, 'food', '2026-07-02'::date, 'rejected', 'faculty_grant')`,
    [caseM.activityId, userA],
  );
  const bundleM = await loadProjectBundle(client, userA, caseM.projectId);
  const actM = buildProjectSummary(
    bundleM.project,
    bundleM.activities,
    bundleM.incomes,
    bundleM.expenses,
  ).activities[0];
  const fundM = fundOf(actM, "faculty_grant");
  assertEq("faculty totalReceived", fundM.totalReceived, "20000.00");
  assertEq("faculty totalSpent", fundM.totalSpent, "5000.00");
  assertEq("faculty remaining", fundM.remaining, "15000.00");
  console.log("");

  // (n) Long-term rollup with funds
  console.log("(n) Long-term rollup with funds");
  const { rows: longN } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, budget_target)
     VALUES ($1, 'fund rollup long', 'long', 0)
     RETURNING id`,
    [userA],
  );
  const longNId = longN[0].id;
  await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, is_general, sort_order)
     VALUES ($1, $2, 'กองกลาง', 0, true, -1)`,
    [longNId, userA],
  );
  const { rows: actsN } = await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, sort_order)
     VALUES ($1, $2, 'act1 fund', 0, 0),
            ($1, $2, 'act2 fund', 0, 1)
     RETURNING id`,
    [longNId, userA],
  );
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2026-07-01'::date, 'paid'),
            ($3, $2, 20000.00, 'faculty_grant', '2026-07-02'::date, 'paid')`,
    [actsN[0].id, userA, actsN[1].id],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status, fund_source)
     VALUES ($1, $2, 9000.00, 'venue', '2026-07-01'::date, 'paid', 'faculty_grant'),
            ($3, $2, 5000.00, 'food', '2026-07-02'::date, 'paid', 'faculty_grant')`,
    [actsN[0].id, userA, actsN[1].id],
  );
  const bundleN = await loadProjectBundle(client, userA, longNId);
  const summaryN = buildProjectSummary(
    bundleN.project,
    bundleN.activities,
    bundleN.incomes,
    bundleN.expenses,
  );
  const fundN = fundOf(summaryN, "faculty_grant");
  assertEq("rollup faculty totalReceived", fundN.totalReceived, "50000.00");
  assertEq("rollup faculty totalSpent", fundN.totalSpent, "14000.00");
  assertEq("rollup faculty remaining", fundN.remaining, "36000.00");
  assertBool("rollup faculty isOverspent", fundN.isOverspent, false);
  console.log("");

  // (o) Long project — กองกลาง activity exists + rollup includes it
  console.log("(o) Long project — กองกลาง activity exists");
  const { rows: oProj } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, budget_target, start_date, end_date)
     VALUES ($1, 'งบชมรม ปี 2570', 'long', 50000.00, '2027-01-01'::date, '2027-12-31'::date)
     RETURNING id`,
    [userA],
  );
  const oProjectId = oProj[0].id;
  await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, is_general, sort_order)
     VALUES ($1, $2, 'กองกลาง', 0, true, -1)`,
    [oProjectId, userA],
  );
  const { rows: oGeneralRows } = await client.query(
    `SELECT id, name, is_general, sort_order
     FROM project_activities
     WHERE project_id = $1 AND user_id = $2 AND is_general = true`,
    [oProjectId, userA],
  );
  assertEq("กองกลาง count", oGeneralRows.length, 1);
  assertBool("กองกลาง is_general", oGeneralRows[0].is_general, true);
  assertEq("กองกลาง sort_order", oGeneralRows[0].sort_order, -1);
  const oGeneralId = oGeneralRows[0].id;
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date)
     VALUES ($1, $2, 30000.00, 'faculty_grant', '2027-01-10'::date)`,
    [oGeneralId, userA],
  );
  const { rows: oAct } = await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, sort_order)
     VALUES ($1, $2, 'ค่ายรับน้อง', 20000.00, 0)
     RETURNING id`,
    [oProjectId, userA],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date)
     VALUES ($1, $2, 9000.00, 'venue', '2027-01-11'::date)`,
    [oAct[0].id, userA],
  );
  const bundleO = await loadProjectBundle(client, userA, oProjectId);
  const summaryO = buildProjectSummary(bundleO.project, bundleO.activities, bundleO.incomes, bundleO.expenses);
  assertEq("project totalFunding", summaryO.totalFunding, "30000.00");
  assertEq("project totalSpent", summaryO.totalSpent, "9000.00");
  assertEq("project remaining", summaryO.remaining, "21000.00");
  assertEq("activityCount includes กองกลาง", summaryO.activityCount, 2);
  console.log("");

  // (p) Short project — no กองกลาง
  console.log("(p) Short project — has NO กองกลาง");
  const caseP = await insertShortWithActivity(userA, "short no general", "10000.00");
  const { rows: pActs } = await client.query(
    `SELECT id, is_general FROM project_activities WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [caseP.projectId],
  );
  assertEq("short activities count", pActs.length, 1);
  assertBool("short activity is_general=false", pActs[0].is_general, false);
  console.log("");

  // (q) Advance tracking
  console.log("(q) Advance tracking — totals + by payer");
  const caseQ = await insertShortWithActivity(userA, "advance tracking", "0.00");
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, payer_name, entry_date, is_advance, reimbursed_at)
     VALUES ($1, $2, 5000.00, 'venue', 'น้องเอ', '2026-07-01'::date, true, NULL),
            ($1, $2, 3000.00, 'food', 'น้องเอ', '2026-07-02'::date, true, '2026-07-03T10:00:00.000Z'::timestamptz),
            ($1, $2, 2000.00, 'transport', NULL, '2026-07-02'::date, false, NULL)`,
    [caseQ.activityId, userA],
  );
  const bundleQ = await loadProjectBundle(client, userA, caseQ.projectId);
  const actQ = buildProjectSummary(bundleQ.project, bundleQ.activities, bundleQ.incomes, bundleQ.expenses).activities[0];
  assertEq("totalSpent", actQ.totalSpent, "10000.00");
  assertEq("advanceTotal", actQ.advanceTotal, "8000.00");
  assertEq("advanceUnreimbursed", actQ.advanceUnreimbursed, "5000.00");
  assertEq("advanceByPayer length", actQ.advanceByPayer.length, 1);
  assertEq("advanceByPayer[0] payerName", actQ.advanceByPayer[0].payerName, "น้องเอ");
  assertEq("advanceByPayer[0] total", actQ.advanceByPayer[0].total, "8000.00");
  assertEq("advanceByPayer[0] unreimbursed", actQ.advanceByPayer[0].unreimbursed, "5000.00");
  console.log("");

  // (r) Income cash/transfer split
  console.log("(r) Income cash/transfer split");
  const caseR = await insertShortWithActivity(userA, "cash transfer split", "0.00");
  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_method)
     VALUES ($1, $2, 20000.00, 'faculty_grant', '2026-07-01'::date, 'cash'),
            ($1, $2, 10000.00, 'membership', '2026-07-01'::date, 'transfer')`,
    [caseR.activityId, userA],
  );
  const bundleR = await loadProjectBundle(client, userA, caseR.projectId);
  const actR = buildProjectSummary(bundleR.project, bundleR.activities, bundleR.incomes, bundleR.expenses).activities[0];
  assertEq("totalFunding", actR.totalFunding, "30000.00");
  assertEq("cashFunding", actR.cashFunding, "20000.00");
  assertEq("transferFunding", actR.transferFunding, "10000.00");
  console.log("");

  if (failed) {
    console.error(`${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("All assertions passed.");
} catch (err) {
  console.error("Project summary test crashed:", err.message);
  process.exit(1);
} finally {
  if (userA) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userA]).catch(() => {});
  }
  await client.end();
}
