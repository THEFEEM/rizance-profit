import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { SHOW_ORG_MODE, SHOW_PERSONAL_MODE } from "@/lib/feature-flags";

/** True when the user has any personal-mode ledger data (grandfather access). */
export async function userHasPersonalData(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM personal_income_entries WHERE user_id = $1
       UNION ALL
       SELECT 1 FROM personal_expense_entries WHERE user_id = $1
       UNION ALL
       SELECT 1 FROM savings_goals WHERE user_id = $1
     ) AS ok`,
    [userId],
  );
  return rows[0]?.ok === true;
}

/** True when the user owns at least one project (grandfather access). */
export async function userHasOrgData(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM projects WHERE user_id = $1) AS ok`,
    [userId],
  );
  return rows[0]?.ok === true;
}

/** Redirect to /home when personal routes are hidden and user has no personal data. */
export async function guardPersonalRoute(userId: string): Promise<void> {
  if (SHOW_PERSONAL_MODE) return;
  if (await userHasPersonalData(userId)) return;
  redirect("/home");
}

/** Redirect to /home when org routes are hidden and user has no projects. */
export async function guardOrgRoute(userId: string): Promise<void> {
  if (SHOW_ORG_MODE) return;
  if (await userHasOrgData(userId)) return;
  redirect("/home");
}
