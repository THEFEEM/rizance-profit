// Project mode data access — separate tables; never touches shop/booth entries.
import { pool } from "@/lib/db";
import type {
  ProjectActivityInput,
  ProjectExpenseInput,
  ProjectIncomeInput,
  ProjectInput,
  ProjectMemberInput,
} from "@/lib/project-validation";
import type {
  Project,
  ProjectActivity,
  ProjectExpense,
  ProjectIncome,
  ProjectMember,
  ProjectStatus,
  ProjectType,
} from "@/types/project";

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

type ProjectRow = {
  id: string;
  name: string;
  project_type: string;
  org_name: string | null;
  budget_target: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  note: string | null;
  created_at: Date | string;
};

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    projectType: r.project_type as ProjectType,
    orgName: r.org_name,
    budgetTarget: r.budget_target,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status as ProjectStatus,
    note: r.note,
    createdAt: toIso(r.created_at),
  };
}

const PROJECT_RETURN = `id, name, project_type, org_name, budget_target,
  start_date::text AS start_date, end_date::text AS end_date,
  status, note, created_at`;

type ActivityRow = {
  id: string;
  project_id: string;
  name: string;
  budget_target: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  note: string | null;
  sort_order: number;
  created_at: Date | string;
};

function mapActivity(r: ActivityRow): ProjectActivity {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    budgetTarget: r.budget_target,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status as ProjectStatus,
    note: r.note,
    sortOrder: r.sort_order,
    createdAt: toIso(r.created_at),
  };
}

const ACTIVITY_RETURN = `id, project_id, name, budget_target,
  start_date::text AS start_date, end_date::text AS end_date,
  status, note, sort_order, created_at`;

type IncomeRow = {
  id: string;
  activity_id: string;
  amount: string;
  source: string;
  label: string | null;
  entry_date: string;
  note: string | null;
  receipt_url: string | null;
  created_at: Date | string;
};

function mapIncome(r: IncomeRow): ProjectIncome {
  return {
    id: r.id,
    activityId: r.activity_id,
    amount: r.amount,
    source: r.source,
    label: r.label,
    entryDate: r.entry_date,
    note: r.note,
    receiptUrl: r.receipt_url,
    createdAt: toIso(r.created_at),
  };
}

const INCOME_RETURN = `id, activity_id, amount, source, label,
  entry_date::text AS entry_date, note, receipt_url, created_at`;

type ExpenseRow = {
  id: string;
  activity_id: string;
  amount: string;
  category: string;
  label: string | null;
  payer_name: string | null;
  entry_date: string;
  note: string | null;
  receipt_url: string | null;
  created_at: Date | string;
};

function mapExpense(r: ExpenseRow): ProjectExpense {
  return {
    id: r.id,
    activityId: r.activity_id,
    amount: r.amount,
    category: r.category,
    label: r.label,
    payerName: r.payer_name,
    entryDate: r.entry_date,
    note: r.note,
    receiptUrl: r.receipt_url,
    createdAt: toIso(r.created_at),
  };
}

const EXPENSE_RETURN = `id, activity_id, amount, category, label, payer_name,
  entry_date::text AS entry_date, note, receipt_url, created_at`;

type MemberRow = {
  id: string;
  project_id: string;
  name: string;
  role: string;
  note: string | null;
  created_at: Date | string;
};

function mapMember(r: MemberRow): ProjectMember {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    role: r.role as ProjectMember["role"],
    note: r.note,
    createdAt: toIso(r.created_at),
  };
}

const MEMBER_RETURN = `id, project_id, name, role, note, created_at`;

async function getOwnedProject(userId: string, projectId: string): Promise<Project | null> {
  const { rows } = await pool.query<ProjectRow>(
    `SELECT ${PROJECT_RETURN} FROM projects WHERE user_id = $1 AND id = $2`,
    [userId, projectId],
  );
  return rows[0] ? mapProject(rows[0]) : null;
}

async function getOwnedActivity(
  userId: string,
  activityId: string,
): Promise<ProjectActivity | null> {
  const { rows } = await pool.query<ActivityRow>(
    `SELECT ${ACTIVITY_RETURN} FROM project_activities WHERE user_id = $1 AND id = $2`,
    [userId, activityId],
  );
  return rows[0] ? mapActivity(rows[0]) : null;
}

// ---- projects ---------------------------------------------------------------

export async function listProjects(userId: string): Promise<Project[]> {
  const { rows } = await pool.query<ProjectRow>(
    `SELECT ${PROJECT_RETURN} FROM projects
     WHERE user_id = $1
     ORDER BY status ASC, created_at DESC`,
    [userId],
  );
  return rows.map(mapProject);
}

export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  return getOwnedProject(userId, projectId);
}

/** Option A: short-term projects auto-create exactly one activity (same name/dates/budget). */
export async function createProject(userId: string, input: ProjectInput): Promise<Project> {
  const budget = (input.budgetTarget ?? 0).toFixed(2);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO projects (user_id, name, project_type, org_name, budget_target, start_date, end_date, note)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8)
       RETURNING id`,
      [
        userId,
        input.name,
        input.projectType,
        input.orgName ?? null,
        budget,
        input.startDate ?? null,
        input.endDate ?? null,
        input.note ?? null,
      ],
    );
    const projectId = rows[0].id;

    if (input.projectType === "short") {
      await client.query(
        `INSERT INTO project_activities (project_id, user_id, name, budget_target, start_date, end_date, note, sort_order)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, 0)`,
        [
          projectId,
          userId,
          input.name,
          budget,
          input.startDate ?? null,
          input.endDate ?? null,
          input.note ?? null,
        ],
      );
    }

    await client.query("COMMIT");
    const project = await getProject(userId, projectId);
    if (!project) throw new Error("Project create failed");
    return project;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---- activities -------------------------------------------------------------

export async function listActivities(
  userId: string,
  projectId: string,
): Promise<ProjectActivity[]> {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return [];

  const { rows } = await pool.query<ActivityRow>(
    `SELECT ${ACTIVITY_RETURN} FROM project_activities
     WHERE user_id = $1 AND project_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [userId, projectId],
  );
  return rows.map(mapActivity);
}

export async function getActivity(
  userId: string,
  activityId: string,
): Promise<ProjectActivity | null> {
  return getOwnedActivity(userId, activityId);
}

export async function createActivity(
  userId: string,
  projectId: string,
  input: ProjectActivityInput,
): Promise<ProjectActivity | null> {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;

  const { rows } = await pool.query<ActivityRow>(
    `INSERT INTO project_activities (project_id, user_id, name, budget_target, start_date, end_date, note, sort_order)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8)
     RETURNING ${ACTIVITY_RETURN}`,
    [
      projectId,
      userId,
      input.name,
      (input.budgetTarget ?? 0).toFixed(2),
      input.startDate ?? null,
      input.endDate ?? null,
      input.note ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return rows[0] ? mapActivity(rows[0]) : null;
}

// ---- income -----------------------------------------------------------------

export async function listProjectIncome(
  userId: string,
  activityId: string,
): Promise<ProjectIncome[]> {
  const activity = await getOwnedActivity(userId, activityId);
  if (!activity) return [];

  const { rows } = await pool.query<IncomeRow>(
    `SELECT ${INCOME_RETURN} FROM project_income_entries
     WHERE user_id = $1 AND activity_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, activityId],
  );
  return rows.map(mapIncome);
}

export async function createProjectIncome(
  userId: string,
  activityId: string,
  input: ProjectIncomeInput,
): Promise<ProjectIncome | null> {
  const activity = await getOwnedActivity(userId, activityId);
  if (!activity) return null;

  const { rows } = await pool.query<IncomeRow>(
    `INSERT INTO project_income_entries (activity_id, user_id, amount, source, label, entry_date, note)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7)
     RETURNING ${INCOME_RETURN}`,
    [
      activityId,
      userId,
      input.amount.toFixed(2),
      input.source,
      input.label ?? null,
      input.entryDate,
      input.note ?? null,
    ],
  );
  return rows[0] ? mapIncome(rows[0]) : null;
}

// ---- expense ----------------------------------------------------------------

export async function listProjectExpense(
  userId: string,
  activityId: string,
): Promise<ProjectExpense[]> {
  const activity = await getOwnedActivity(userId, activityId);
  if (!activity) return [];

  const { rows } = await pool.query<ExpenseRow>(
    `SELECT ${EXPENSE_RETURN} FROM project_expense_entries
     WHERE user_id = $1 AND activity_id = $2
     ORDER BY entry_date DESC, created_at DESC`,
    [userId, activityId],
  );
  return rows.map(mapExpense);
}

export async function createProjectExpense(
  userId: string,
  activityId: string,
  input: ProjectExpenseInput,
): Promise<ProjectExpense | null> {
  const activity = await getOwnedActivity(userId, activityId);
  if (!activity) return null;

  const { rows } = await pool.query<ExpenseRow>(
    `INSERT INTO project_expense_entries (activity_id, user_id, amount, category, label, payer_name, entry_date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
     RETURNING ${EXPENSE_RETURN}`,
    [
      activityId,
      userId,
      input.amount.toFixed(2),
      input.category,
      input.label ?? null,
      input.payerName ?? null,
      input.entryDate,
      input.note ?? null,
    ],
  );
  return rows[0] ? mapExpense(rows[0]) : null;
}

// ---- members ----------------------------------------------------------------

export async function listProjectMembers(
  userId: string,
  projectId: string,
): Promise<ProjectMember[]> {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return [];

  const { rows } = await pool.query<MemberRow>(
    `SELECT ${MEMBER_RETURN} FROM project_members
     WHERE user_id = $1 AND project_id = $2
     ORDER BY created_at ASC`,
    [userId, projectId],
  );
  return rows.map(mapMember);
}

export async function createProjectMember(
  userId: string,
  projectId: string,
  input: ProjectMemberInput,
): Promise<ProjectMember | null> {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;

  const { rows } = await pool.query<MemberRow>(
    `INSERT INTO project_members (project_id, user_id, name, role, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${MEMBER_RETURN}`,
    [projectId, userId, input.name, input.role ?? "member", input.note ?? null],
  );
  return rows[0] ? mapMember(rows[0]) : null;
}

/** Convenience for short-term projects — returns the single auto-created activity. */
export async function getShortProjectActivity(
  userId: string,
  projectId: string,
): Promise<ProjectActivity | null> {
  const project = await getOwnedProject(userId, projectId);
  if (!project || project.projectType !== "short") return null;
  const activities = await listActivities(userId, projectId);
  return activities[0] ?? null;
}
