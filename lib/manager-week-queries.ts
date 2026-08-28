import { pool } from "@/lib/db";
import { addDays } from "@/lib/date";
import { centsToDecimalString, toCents } from "@/lib/money";
import { weekStartOf } from "@/lib/manager-duty-queries";

/**
 * ค่าตอบแทนผู้จัดการรายสัปดาห์ — ฝั่งเจ้าของ (M3 · 0091)
 *
 * ═══ invariant ที่เจ้าของสั่ง (28 ส.ค. 2569) ══════════════════════
 *   Manager Payroll Source = Owner Approved Weekly Compensation
 *   · 2/3 duties ระบบห้ามสรุปเองว่าจ่าย ฿400 — เจ้าของตัดสิน
 *   · ปรับไม่เท่าข้อตกลง → ต้องมีเหตุผล (CHECK ใน 0091 บังคับซ้ำ)
 *   · ห้าม manager_daily_rate กับ weekly approval จ่ายพร้อมกันในงวดใหม่
 *     — บังคับที่ managerPayrollCents(): งวดที่เริ่ม >= CUTOVER ใช้ approvals
 *       งวดเก่าใช้สูตรเดิม ไม่ย้อนแก้
 */

export class WeekApprovalNotFoundError extends Error {
  constructor() {
    super("week_approval_not_found");
    this.name = "WeekApprovalNotFoundError";
  }
}
export class WeekAlreadyApprovedError extends Error {
  constructor() {
    super("week_already_approved");
    this.name = "WeekAlreadyApprovedError";
  }
}
export class AdjustReasonRequiredError extends Error {
  constructor() {
    super("adjust_reason_required");
    this.name = "AdjustReasonRequiredError";
  }
}

/**
 * วันตัดโหมดเงินผู้จัดการ — งวด payroll ที่ "เริ่ม" ตั้งแต่วันนี้เป็นต้นไป
 * ใช้ weekly approvals · งวดที่เริ่มก่อนหน้าใช้สูตรเดิม (฿200/วัน) ไม่ย้อนแก้
 *
 * ตั้งเป็นวันอาทิตย์ถัดจากวัน deploy M3 (31 ส.ค. 2569 คือวันอาทิตย์)
 * เผื่ออนาคตย้ายร้านใหม่: ร้านที่สมัครหลังวันนี้ใช้โหมดใหม่ตั้งแต่ต้นโดยปริยาย
 */
export const MANAGER_WEEKLY_CUTOVER = "2026-08-31";

// ═══ สรุปสัปดาห์ให้เจ้าของดูก่อนอนุมัติ ═══════════════════════════

export type ManagerWeekSummary = {
  employeeId: string;
  employeeName: string;
  weekStart: string;
  weekEnd: string;
  dutiesDone: number;
  dutiesTarget: number;
  /** ข้อตกลงปัจจุบัน (฿600) */
  agreedAmount: string;
  /** สถานะการอนุมัติของสัปดาห์นี้ */
  approval: {
    id: string;
    status: "pending" | "approved";
    approvedAmount: string | null;
    adjustReason: string | null;
    approvedAt: string | null;
  } | null;
  /** ประกอบการตัดสิน */
  cashChecks: number;
  cashDifferenceTotal: string;
  openIssues: number;
  duties: {
    dutyNo: string;
    businessDate: string;
    status: string;
    ownerNote: string | null;
    counts: { done: number; notRequired: number; issues: number; pending: number } | null;
  }[];
};

/** สรุปผู้จัดการทุกคนของสัปดาห์ (ระบุ weekStart เป็นวันอาทิตย์ หรือปล่อยให้คิดจากวันนี้) */
export async function managerWeekSummaries(
  userId: string,
  weekStartInput?: string,
): Promise<ManagerWeekSummary[]> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const weekStart = weekStartOf(weekStartInput ?? today);
  const weekEnd = addDays(weekStart, 6);

  const [{ rows: managers }, { rows: settings }] = await Promise.all([
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM employees
       WHERE user_id = $1 AND hr_role = 'manager' AND status = 'active'
       ORDER BY name`,
      [userId],
    ),
    pool.query<{ manager_weekly_wage: string; manager_weekly_duties: number }>(
      `SELECT manager_weekly_wage::text AS manager_weekly_wage, manager_weekly_duties
       FROM hr_settings WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const agreed = settings[0]?.manager_weekly_wage ?? "600.00";
  const target = settings[0]?.manager_weekly_duties ?? 3;

  return Promise.all(
    managers.map(async (m) => {
      const [duties, approval, cash, issues] = await Promise.all([
        pool.query<{
          duty_no: string; business_date: string; status: string;
          owner_note: string | null; summary: { counts?: ManagerWeekSummary["duties"][number]["counts"] } | null;
        }>(
          `SELECT duty_no, business_date::text AS business_date, status, owner_note, summary
           FROM manager_duties
           WHERE user_id = $1 AND employee_id = $2
             AND business_date BETWEEN $3::date AND $4::date
             AND status <> 'cancelled'
           ORDER BY business_date`,
          [userId, m.id, weekStart, weekEnd],
        ),
        pool.query<{
          id: string; status: "pending" | "approved"; approved_amount: string | null;
          adjust_reason: string | null; approved_at: string | null;
        }>(
          `SELECT id, status, approved_amount::text AS approved_amount,
                  adjust_reason, approved_at::text AS approved_at
           FROM manager_week_approvals
           WHERE user_id = $1 AND employee_id = $2 AND week_start = $3::date`,
          [userId, m.id, weekStart],
        ),
        pool.query<{ n: string; diff: string }>(
          `SELECT COUNT(*)::text AS n, COALESCE(SUM(difference), 0)::text AS diff
           FROM daily_cash_checks
           WHERE user_id = $1 AND status = 'completed'
             AND business_date BETWEEN $2::date AND $3::date`,
          [userId, weekStart, weekEnd],
        ),
        pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM store_notes
           WHERE user_id = $1 AND type = 'problem' AND status = 'open'`,
          [userId],
        ),
      ]);

      return {
        employeeId: m.id,
        employeeName: m.name,
        weekStart,
        weekEnd,
        dutiesDone: duties.rows.filter((d) => d.status === "completed").length,
        dutiesTarget: target,
        agreedAmount: agreed,
        approval: approval.rows[0]
          ? {
              id: approval.rows[0].id,
              status: approval.rows[0].status,
              approvedAmount: approval.rows[0].approved_amount,
              adjustReason: approval.rows[0].adjust_reason,
              approvedAt: approval.rows[0].approved_at,
            }
          : null,
        cashChecks: Number(cash.rows[0].n),
        cashDifferenceTotal: cash.rows[0].diff,
        openIssues: Number(issues.rows[0].n),
        duties: duties.rows.map((d) => ({
          dutyNo: d.duty_no,
          businessDate: d.business_date,
          status: d.status,
          ownerNote: d.owner_note,
          counts: d.summary?.counts ?? null,
        })),
      };
    }),
  );
}

// ═══ อนุมัติ ════════════════════════════════════════════════════

/**
 * อนุมัติค่าตอบแทนสัปดาห์
 *   ไม่ส่ง amount = อนุมัติเต็มตามข้อตกลง (2/3 ก็ได้เต็ม — เจ้าของตัดสิน)
 *   ส่ง amount ≠ ข้อตกลง = ต้องมีเหตุผล
 * upsert: ยังไม่มีใบของสัปดาห์นั้นก็สร้างพร้อมอนุมัติเลย · อนุมัติแล้วห้ามซ้ำ
 */
export async function approveManagerWeek(
  userId: string,
  input: {
    employeeId: string;
    weekStart: string;
    amount?: number | null;
    reason?: string | null;
  },
): Promise<{ approvedAmount: string; adjustReason: string | null }> {
  const weekStart = weekStartOf(input.weekStart);
  const weekEnd = addDays(weekStart, 6);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: settings } = await client.query<{
      manager_weekly_wage: string; manager_weekly_duties: number;
    }>(
      `SELECT manager_weekly_wage::text AS manager_weekly_wage, manager_weekly_duties
       FROM hr_settings WHERE user_id = $1`,
      [userId],
    );
    const agreedCents = toCents(settings[0]?.manager_weekly_wage ?? "600");
    const amountCents =
      input.amount == null ? agreedCents : Math.round(input.amount * 100);
    const reason = input.reason?.trim() || null;
    if (amountCents !== agreedCents && !reason) throw new AdjustReasonRequiredError();

    // นับ duties จริง ณ ตอนอนุมัติ — snapshot ประกอบการตัดสิน ไม่ใช่สูตร
    const { rows: cnt } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM manager_duties
       WHERE user_id = $1 AND employee_id = $2
         AND business_date BETWEEN $3::date AND $4::date AND status = 'completed'`,
      [userId, input.employeeId, weekStart, weekEnd],
    );

    // atomic: สร้างถ้ายังไม่มี → แล้วจับจองอนุมัติเฉพาะใบที่ยัง pending
    await client.query(
      `INSERT INTO manager_week_approvals
         (user_id, employee_id, week_start, duties_done, duties_target, agreed_amount)
       VALUES ($1, $2, $3::date, $4, $5, $6)
       ON CONFLICT (user_id, employee_id, week_start) DO NOTHING`,
      [
        userId,
        input.employeeId,
        weekStart,
        Number(cnt[0].n),
        settings[0]?.manager_weekly_duties ?? 3,
        centsToDecimalString(agreedCents),
      ],
    );
    const { rows: claimed } = await client.query<{ id: string }>(
      `UPDATE manager_week_approvals SET
         status = 'approved',
         duties_done = $4,
         approved_amount = $5,
         adjust_reason = $6,
         approved_at = now(),
         updated_at = now()
       WHERE user_id = $1 AND employee_id = $2 AND week_start = $3::date
         AND status = 'pending'
       RETURNING id`,
      [
        userId,
        input.employeeId,
        weekStart,
        Number(cnt[0].n),
        centsToDecimalString(amountCents),
        amountCents === agreedCents ? null : reason,
      ],
    );
    if (!claimed[0]) throw new WeekAlreadyApprovedError();

    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'owner', $2, 'manager_week_approved', $3)`,
      [
        userId,
        input.employeeId,
        JSON.stringify({
          weekStart,
          approvedAmount: centsToDecimalString(amountCents),
          agreedAmount: centsToDecimalString(agreedCents),
          reason,
        }),
      ],
    );

    await client.query("COMMIT");
    return {
      approvedAmount: centsToDecimalString(amountCents),
      adjustReason: amountCents === agreedCents ? null : reason,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ═══ แหล่งเงินผู้จัดการสำหรับ payroll (เรียกจาก calcItemsFromPool) ═══

export type ManagerPayrollLine = {
  employeeId: string;
  employeeName: string;
  /** สตางค์รวมของช่วงงวด */
  totalCents: number;
  /** สัปดาห์ที่นับรวม (โชว์ breakdown ในสลิป) */
  weeks: { weekStart: string; amountCents: number; approved: boolean }[];
};

/**
 * เงินผู้จัดการของช่วงงวด = Σ ยอดสัปดาห์ที่ทับซ้อนกับงวด
 *   สัปดาห์ที่อนุมัติแล้ว → ยอดอนุมัติ
 *   ยังไม่อนุมัติ → ข้อตกลง (฿600) — เจ้าของกดปรับได้จนกว่างวดจะ approve
 *     (ตอน approvePayroll มี recalc สดอยู่แล้ว ค่าล่าสุดจึงถูกใช้เสมอ)
 *   สัปดาห์ที่ "ไม่มีรอบงานเลยและไม่มีใบอนุมัติ" → ฿0 (ไม่ได้ทำงาน)
 */
export async function managerPayrollLines(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ManagerPayrollLine[]> {
  const { rows: managers } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM employees
     WHERE user_id = $1 AND hr_role = 'manager' AND status = 'active'
     ORDER BY name`,
    [userId],
  );
  if (managers.length === 0) return [];

  const { rows: settings } = await pool.query<{ manager_weekly_wage: string }>(
    `SELECT manager_weekly_wage::text AS manager_weekly_wage
     FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  const agreedCents = toCents(settings[0]?.manager_weekly_wage ?? "600");

  // ทุกสัปดาห์ (วันอาทิตย์) ที่ทับซ้อนช่วงงวด
  const weeks: string[] = [];
  for (
    let w = weekStartOf(periodStart);
    w <= periodEnd;
    w = addDays(w, 7)
  ) {
    weeks.push(w);
  }

  return Promise.all(
    managers.map(async (m) => {
      const lines: ManagerPayrollLine["weeks"] = [];
      for (const w of weeks) {
        const { rows: appr } = await pool.query<{
          status: string; approved_amount: string | null;
        }>(
          `SELECT status, approved_amount::text AS approved_amount
           FROM manager_week_approvals
           WHERE user_id = $1 AND employee_id = $2 AND week_start = $3::date`,
          [userId, m.id, w],
        );
        if (appr[0]?.status === "approved" && appr[0].approved_amount != null) {
          lines.push({ weekStart: w, amountCents: toCents(appr[0].approved_amount), approved: true });
          continue;
        }
        // ยังไม่อนุมัติ: มีรอบงานในสัปดาห์นั้นไหม — มี = ตั้งต้นตามข้อตกลง
        const { rows: worked } = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM manager_duties
           WHERE user_id = $1 AND employee_id = $2
             AND business_date BETWEEN $3::date AND ($3::date + 6)
             AND status = 'completed'`,
          [userId, m.id, w],
        );
        if (Number(worked[0].n) > 0 || appr[0]) {
          lines.push({ weekStart: w, amountCents: agreedCents, approved: false });
        }
      }
      return {
        employeeId: m.id,
        employeeName: m.name,
        totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
        weeks: lines,
      };
    }),
  );
}
