// Project summary canonical cases (a–e) — Option B fetch + JS aggregate.
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
  assertEq("activity count", summaryD.activityCount, 2);
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
