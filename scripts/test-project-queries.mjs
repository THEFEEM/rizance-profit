// DB sanity: short project auto-activity (Option A) + long project with 2 activities.
// Skips gracefully if migration 0011 not applied yet.
// Usage: npm run test:project-queries
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
function assert(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const client = new pg.Client(pgClientOptions(connectionString));
let userId = null;
let shortProjectId = null;
let longProjectId = null;

async function createShortProject(uid, input) {
  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      `INSERT INTO projects (user_id, name, project_type, org_name, budget_target, start_date, end_date, note)
       VALUES ($1, $2, 'short', $3, $4, $5::date, $6::date, $7)
       RETURNING id`,
      [uid, input.name, input.orgName, input.budget, input.startDate, input.endDate, input.note],
    );
    const projectId = rows[0].id;
    await client.query(
      `INSERT INTO project_activities (project_id, user_id, name, budget_target, start_date, end_date, note, sort_order)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, 0)`,
      [projectId, uid, input.name, input.budget, input.startDate, input.endDate, input.note],
    );
    await client.query("COMMIT");
    return projectId;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

try {
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'projects'`,
  );
  if (tables.length === 0) {
    console.log("=== PROJECT QUERIES SANITY TEST ===\n");
    console.log("⊘ Skipped — projects table not found (run migration 0011_project_mode.sql first).");
    process.exit(0);
  }

  console.log("=== PROJECT QUERIES SANITY TEST ===\n");

  const email = `project-db-${Date.now()}@rizance.test`;
  const { rows: users } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'project-db-test', 'Project Test Shop') RETURNING id`,
    [email],
  );
  userId = users[0].id;
  console.log(`Temp user: ${email}\n`);

  console.log("1) Short project — Option A auto-activity");
  shortProjectId = await createShortProject(userId, {
    name: "ค่ายรับน้อง 2569",
    orgName: "ชมรมถ่ายภาพ",
    budget: "50000.00",
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    note: "short-term camp",
  });
  const { rows: shortActs } = await client.query(
    `SELECT id, name FROM project_activities WHERE project_id = $1 AND user_id = $2`,
    [shortProjectId, userId],
  );
  assert("short project has exactly 1 activity", shortActs.length === 1);
  assert("auto-activity name matches project", shortActs[0].name === "ค่ายรับน้อง 2569");

  await client.query(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date)
     VALUES ($1, $2, 10000.00, 'faculty_grant', '2026-07-01'::date)`,
    [shortActs[0].id, userId],
  );
  await client.query(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date)
     VALUES ($1, $2, 2500.00, 'venue', '2026-07-01'::date)`,
    [shortActs[0].id, userId],
  );
  const { rows: shortIncome } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM project_income_entries WHERE activity_id = $1`,
    [shortActs[0].id],
  );
  assert("short activity income scoped", shortIncome[0].total === "10000.00");
  console.log("");

  console.log("2) Long project — manual activities");
  const { rows: longRows } = await client.query(
    `INSERT INTO projects (user_id, name, project_type, org_name, budget_target, start_date, end_date)
     VALUES ($1, 'งบชมรม ปี 2569', 'long', 'ชมรมถ่ายภาพ', 120000.00, '2026-01-01'::date, '2026-12-31'::date)
     RETURNING id`,
    [userId],
  );
  longProjectId = longRows[0].id;

  await client.query(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, sort_order)
     VALUES ($1, $2, 'ค่ายรับน้อง', 50000.00, 0),
            ($1, $2, 'งานบวช', 30000.00, 1)`,
    [longProjectId, userId],
  );
  const { rows: longActs } = await client.query(
    `SELECT COUNT(*)::text AS n FROM project_activities WHERE project_id = $1`,
    [longProjectId],
  );
  assert("long project has 2 activities", longActs[0].n === "2");
  console.log("");

  console.log("3) Members + user scope isolation");
  await client.query(
    `INSERT INTO project_members (project_id, user_id, name, role)
     VALUES ($1, $2, 'น้องเอ', 'treasurer')`,
    [longProjectId, userId],
  );
  const { rows: otherUser } = await client.query(
    `INSERT INTO users (email, password_hash, shop_name)
     VALUES ($1, 'x', 'Other') RETURNING id`,
    [`project-other-${Date.now()}@rizance.test`],
  );
  const otherId = otherUser[0].id;
  const { rows: scoped } = await client.query(
    `SELECT COUNT(*)::text AS n FROM projects WHERE user_id = $1`,
    [otherId],
  );
  assert("other user sees 0 projects", scoped[0].n === "0");
  await client.query(`DELETE FROM users WHERE id = $1`, [otherId]);
  console.log("");

  console.log("4) Summary integration — insert then summarize");
  const bundleShort = await loadProjectBundle(client, userId, shortProjectId);
  if (!bundleShort) {
    assert("loadProjectBundle returns data", false);
  } else {
    const shortSummary = buildProjectSummary(
      bundleShort.project,
      bundleShort.activities,
      bundleShort.incomes,
      bundleShort.expenses,
    );
    assert("summarize totalFunding", shortSummary.totalFunding === "10000.00");
    assert("summarize totalSpent", shortSummary.totalSpent === "2500.00");
    assert("summarize remaining", shortSummary.remaining === "7500.00");
  }
  console.log("");

  const { rows: paymentCol } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'project_expense_entries'
       AND column_name = 'payment_status'`,
  );
  if (paymentCol.length === 0) {
    console.log("5) payment_status — skipped (run migration 0012_project_accounting.sql first)");
    console.log("");
  } else {
    console.log("5) payment_status — insert rejected + pending, read back");
    const actId = shortActs[0].id;
    const { rows: rejRows } = await client.query(
      `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, entry_date, payment_status)
       VALUES ($1, $2, 99.00, 'food', '2026-07-02'::date, 'rejected')
       RETURNING payment_status`,
      [actId, userId],
    );
    assert("rejected expense payment_status", rejRows[0].payment_status === "rejected");
    const { rows: pendRows } = await client.query(
      `INSERT INTO project_income_entries (activity_id, user_id, amount, source, entry_date, payment_status)
       VALUES ($1, $2, 50.00, 'donation', '2026-07-02'::date, 'pending')
       RETURNING payment_status`,
      [actId, userId],
    );
    assert("pending income payment_status", pendRows[0].payment_status === "pending");
    console.log("");
  }

  if (failed) {
    console.error(`${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("All assertions passed.");
} catch (err) {
  console.error("Project queries test crashed:", err.message);
  process.exit(1);
} finally {
  if (userId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
  }
  await client.end();
}
