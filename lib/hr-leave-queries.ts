import { pool } from "@/lib/db";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * HR Phase 5 (0081) — การลา + ข้อยกเว้นเวลาทำงาน
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) อนุมัติลา = สร้างแถว attendance status 'leave' รายวัน + กะวันนั้นเป็น
 *    'leave' → หน้าจอ/รายงานเดิมเห็นทันที ไม่ต้องแก้ query เดิมที่ไหนเลย
 * 2) ลาไม่สร้างค่าแรง: แถว leave ไม่มี regular/ot → payroll engine Phase 4
 *    ที่กรอง status IN ('completed','adjusted') ข้ามไปเอง (ไม่แตะ engine)
 * 3) ทับซ้อน: ตรวจ pending + approved ที่ server ก่อนเขียนใน tx เดียวกัน
 * 4) ยกเลิกใบลาที่อนุมัติแล้ว → ลบเฉพาะแถว leave ที่ระบบสร้าง (leave_id)
 *    ไม่แตะแถวที่พนักงานกดเวลาจริง
 */

export class LeaveOverlapError extends Error {
  constructor(public conflict: { startDate: string; endDate: string; status: string }) {
    super("leave_overlap");
  }
}
export class LeaveNotFoundError extends Error {}
export class LeaveStateError extends Error {}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  branchName: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type LeaveRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  branch_name: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

const LEAVE_SELECT = `
  l.id, l.employee_id, e.name AS employee_name, e.nickname AS employee_nickname,
  b.name AS branch_name, l.leave_type,
  l.start_date::text AS start_date, l.end_date::text AS end_date,
  (l.end_date - l.start_date + 1) AS days,
  l.reason, l.status, l.reviewed_at::text AS reviewed_at, l.review_note,
  l.created_at::text AS created_at
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN branches b ON b.id = l.branch_id`;

function mapLeave(r: LeaveRow): LeaveRequest {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeNickname: r.employee_nickname,
    branchName: r.branch_name,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: Number(r.days),
    reason: r.reason,
    status: r.status,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function employeeByToken(
  token: string,
): Promise<{ id: string; user_id: string; branch_id: string | null } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{ id: string; user_id: string; branch_id: string | null }>(
    `SELECT id, user_id, branch_id FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

async function logHr(
  client: { query: typeof pool.query },
  userId: string,
  actor: "owner" | "staff",
  employeeId: string | null,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, actor, employeeId, action, detail ? JSON.stringify(detail) : null],
  );
}

/** ทับซ้อนกับใบที่ยังนับอยู่ (pending/approved) ของคนเดียวกันไหม */
async function assertNoLeaveOverlap(
  client: { query: typeof pool.query },
  employeeId: string,
  startDate: string,
  endDate: string,
  excludeId?: string,
): Promise<void> {
  const { rows } = await client.query<{
    start_date: string; end_date: string; status: string;
  }>(
    `SELECT start_date::text AS start_date, end_date::text AS end_date, status
     FROM leave_requests
     WHERE employee_id = $1 AND status IN ('pending', 'approved')
       AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       ${excludeId ? "AND id <> $4" : ""}
     LIMIT 1`,
    excludeId ? [employeeId, startDate, endDate, excludeId] : [employeeId, startDate, endDate],
  );
  if (rows[0]) {
    throw new LeaveOverlapError({
      startDate: rows[0].start_date,
      endDate: rows[0].end_date,
      status: rows[0].status,
    });
  }
}

// ── staff ──────────────────────────────────────────────────────

export async function createLeaveByToken(
  token: string,
  input: { leaveType: string; startDate: string; endDate: string; reason?: string | null },
): Promise<LeaveRequest | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertNoLeaveOverlap(client, emp.id, input.startDate, input.endDate);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO leave_requests
         (user_id, employee_id, branch_id, leave_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7)
       RETURNING id`,
      [emp.user_id, emp.id, emp.branch_id, input.leaveType,
       input.startDate, input.endDate, input.reason?.trim() || null],
    );
    await logHr(client, emp.user_id, "staff", emp.id, "leave_created", {
      leaveId: rows[0].id, leaveType: input.leaveType,
      startDate: input.startDate, endDate: input.endDate,
    });
    await client.query("COMMIT");
    return await getLeave(emp.user_id, rows[0].id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listLeaveByToken(token: string): Promise<{
  leaves: LeaveRequest[];
  leaveTypes: string[];
} | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const [{ rows }, { rows: settings }] = await Promise.all([
    pool.query<LeaveRow>(
      `SELECT ${LEAVE_SELECT} WHERE l.employee_id = $1
       ORDER BY l.start_date DESC LIMIT 20`,
      [emp.id],
    ),
    pool.query<{ leave_types: string[] }>(
      `SELECT leave_types FROM hr_settings WHERE user_id = $1`,
      [emp.user_id],
    ),
  ]);
  return {
    leaves: rows.map(mapLeave),
    leaveTypes: settings[0]?.leave_types ?? ["sick", "personal", "vacation", "other"],
  };
}

/** พนักงานยกเลิกได้เฉพาะใบของตัวเองที่ยัง pending */
export async function cancelLeaveByToken(
  token: string,
  leaveId: string,
): Promise<boolean | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const { rowCount } = await pool.query(
    `UPDATE leave_requests SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND employee_id = $2 AND status = 'pending'`,
    [leaveId, emp.id],
  );
  if ((rowCount ?? 0) === 0) return false;
  await logHr(pool, emp.user_id, "staff", emp.id, "leave_cancelled", { leaveId });
  return true;
}

// ── owner ──────────────────────────────────────────────────────

export async function getLeave(userId: string, id: string): Promise<LeaveRequest | null> {
  const { rows } = await pool.query<LeaveRow>(
    `SELECT ${LEAVE_SELECT} WHERE l.user_id = $1 AND l.id = $2`,
    [userId, id],
  );
  return rows[0] ? mapLeave(rows[0]) : null;
}

export async function listLeaves(
  userId: string,
  filter?: { status?: LeaveStatus; employeeId?: string },
): Promise<{ leaves: LeaveRequest[]; counts: Record<LeaveStatus, number> }> {
  const conds = ["l.user_id = $1"];
  const params: string[] = [userId];
  let i = 2;
  if (filter?.status) {
    conds.push(`l.status = $${i}`);
    params.push(filter.status);
    i += 1;
  }
  if (filter?.employeeId) {
    conds.push(`l.employee_id = $${i}`);
    params.push(filter.employeeId);
    i += 1;
  }
  const [{ rows }, { rows: counts }] = await Promise.all([
    pool.query<LeaveRow>(
      `SELECT ${LEAVE_SELECT} WHERE ${conds.join(" AND ")}
       ORDER BY l.status = 'pending' DESC, l.start_date DESC LIMIT 100`,
      params,
    ),
    pool.query<{ status: LeaveStatus; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM leave_requests
       WHERE user_id = $1 GROUP BY status`,
      [userId],
    ),
  ]);
  const base: Record<LeaveStatus, number> = {
    pending: 0, approved: 0, rejected: 0, cancelled: 0,
  };
  for (const c of counts) base[c.status] = c.n;
  return { leaves: rows.map(mapLeave), counts: base };
}

/** owner สร้างใบลาแทนพนักงานได้ (โทรมาลา) */
export async function createLeaveByOwner(
  userId: string,
  input: {
    employeeId: string; leaveType: string; startDate: string;
    endDate: string; reason?: string | null;
  },
): Promise<LeaveRequest> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: emp } = await client.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM employees WHERE id = $1 AND user_id = $2`,
      [input.employeeId, userId],
    );
    if (!emp[0]) throw new LeaveNotFoundError();
    await assertNoLeaveOverlap(client, input.employeeId, input.startDate, input.endDate);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO leave_requests
         (user_id, employee_id, branch_id, leave_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7) RETURNING id`,
      [userId, input.employeeId, emp[0].branch_id, input.leaveType,
       input.startDate, input.endDate, input.reason?.trim() || null],
    );
    await logHr(client, userId, "owner", input.employeeId, "leave_created", {
      leaveId: rows[0].id, byOwner: true,
    });
    await client.query("COMMIT");
    return (await getLeave(userId, rows[0].id))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * อนุมัติ = สร้างแถว attendance 'leave' ทุกวันในช่วง + กะวันนั้นเป็น 'leave'
 * ไม่ทับแถวที่มีอยู่แล้ว (พนักงานเผลอกดเวลาไปแล้ว → คงของจริงไว้ ข้ามวันนั้น)
 */
export async function reviewLeave(
  userId: string,
  leaveId: string,
  input: { decision: "approve" | "reject"; note?: string | null },
): Promise<LeaveRequest> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{
      employee_id: string; branch_id: string | null; status: LeaveStatus;
      start_date: string; end_date: string;
    }>(
      `SELECT employee_id, branch_id, status,
              start_date::text AS start_date, end_date::text AS end_date
       FROM leave_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [leaveId, userId],
    );
    if (!cur[0]) throw new LeaveNotFoundError();
    if (cur[0].status !== "pending") throw new LeaveStateError();

    if (input.decision === "reject") {
      await client.query(
        `UPDATE leave_requests SET status = 'rejected', reviewed_by = 'owner',
           reviewed_at = now(), review_note = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [leaveId, userId, input.note?.trim() || "ไม่ระบุเหตุผล"],
      );
      await logHr(client, userId, "owner", cur[0].employee_id, "leave_rejected", {
        leaveId, note: input.note ?? null,
      });
    } else {
      // ตรวจซ้ำอีกครั้งใต้ lock — กันอนุมัติสองใบทับกัน
      await assertNoLeaveOverlap(
        client, cur[0].employee_id, cur[0].start_date, cur[0].end_date, leaveId,
      );
      await client.query(
        `UPDATE leave_requests SET status = 'approved', reviewed_by = 'owner',
           reviewed_at = now(), review_note = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [leaveId, userId, input.note?.trim() || null],
      );
      // แถว attendance รายวัน — placeholder clock_in = เที่ยงวัน (ไม่ใช่เวลาที่ใครกด)
      await client.query(
        `INSERT INTO attendance
           (user_id, employee_id, branch_id, business_date, clock_in_at,
            status, source, leave_id, note)
         SELECT $1, $2, $3, d::date,
                (d::date + time '12:00') AT TIME ZONE 'Asia/Bangkok',
                'leave', 'manager', $4, 'ลา'
         FROM generate_series($5::date, $6::date, interval '1 day') AS d
         WHERE NOT EXISTS (
           SELECT 1 FROM attendance a
           WHERE a.employee_id = $2 AND a.business_date = d::date
             AND a.status <> 'cancelled')`,
        [userId, cur[0].employee_id, cur[0].branch_id, leaveId,
         cur[0].start_date, cur[0].end_date],
      );
      // กะยังอยู่ (ประวัติตาราง) — แค่เปลี่ยนสถานะเป็น leave
      await client.query(
        `UPDATE shifts SET status = 'leave', updated_at = now()
         WHERE user_id = $1 AND employee_id = $2
           AND business_date BETWEEN $3::date AND $4::date
           AND status IN ('scheduled', 'absent')`,
        [userId, cur[0].employee_id, cur[0].start_date, cur[0].end_date],
      );
      await logHr(client, userId, "owner", cur[0].employee_id, "leave_approved", {
        leaveId, startDate: cur[0].start_date, endDate: cur[0].end_date,
      });
    }
    await client.query("COMMIT");
    return (await getLeave(userId, leaveId))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** owner ยกเลิกใบลา (รวมที่อนุมัติแล้ว) — ถอนเฉพาะแถวที่ระบบสร้าง */
export async function cancelLeaveByOwner(
  userId: string,
  leaveId: string,
): Promise<LeaveRequest> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{ employee_id: string; status: LeaveStatus }>(
      `SELECT employee_id, status FROM leave_requests
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [leaveId, userId],
    );
    if (!cur[0]) throw new LeaveNotFoundError();
    if (cur[0].status === "cancelled") throw new LeaveStateError();

    await client.query(
      `UPDATE leave_requests SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [leaveId, userId],
    );
    // ลบเฉพาะแถวลาที่ระบบสร้างจากใบนี้ (ไม่แตะเวลาจริงที่พนักงานกด)
    await client.query(
      `DELETE FROM attendance WHERE leave_id = $1 AND status = 'leave'`,
      [leaveId],
    );
    await client.query(
      `UPDATE shifts SET status = 'scheduled', updated_at = now()
       WHERE user_id = $1 AND employee_id = $2 AND status = 'leave'
         AND business_date BETWEEN
           (SELECT start_date FROM leave_requests WHERE id = $3)
           AND (SELECT end_date FROM leave_requests WHERE id = $3)`,
      [userId, cur[0].employee_id, leaveId],
    );
    await logHr(client, userId, "owner", cur[0].employee_id, "leave_cancelled", { leaveId });
    await client.query("COMMIT");
    return (await getLeave(userId, leaveId))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Attendance exceptions (owner) ──────────────────────────────

export type AttendanceException = {
  kind: "missing_clock_out" | "late" | "early_leave" | "unscheduled" | "absent";
  attendanceId: string | null;
  shiftId: string | null;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  minutes: number | null;   // สาย/ออกก่อน กี่นาที
  /** วันนี้อยู่ในงวด payroll ที่ลงบัญชีแล้ว — แก้แล้วต้องทำงวดปรับปรุง */
  payrollPosted: boolean;
};

/**
 * รวมข้อยกเว้นของช่วงวันที่:
 *   missing_clock_out · late · early_leave · unscheduled (ทำงานโดยไม่มีกะ)
 *   absent (มีกะแต่ไม่มีเวลาและไม่ได้ลา)
 * พร้อมธง payrollPosted — UI เตือนก่อนแก้
 */
export async function listAttendanceExceptions(
  userId: string,
  range: { from: string; to: string },
): Promise<AttendanceException[]> {
  const { rows } = await pool.query<{
    kind: AttendanceException["kind"];
    attendance_id: string | null;
    shift_id: string | null;
    employee_id: string;
    employee_name: string;
    business_date: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    shift_start_min: number | null;
    shift_end_min: number | null;
    minutes: number | null;
    payroll_posted: boolean;
  }>(
    `WITH att AS (
       SELECT a.*, e.name AS employee_name,
              COALESCE(e.nickname, e.name) AS display_name,
              sh.start_min AS sh_start, sh.end_min AS sh_end
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts sh ON sh.id = a.shift_id
       WHERE a.user_id = $1 AND a.business_date BETWEEN $2::date AND $3::date
         AND a.status NOT IN ('cancelled', 'leave')
     ),
     ex AS (
       -- ลืมกดออกงาน
       SELECT 'missing_clock_out'::text AS kind, id AS attendance_id, shift_id,
              employee_id, display_name AS employee_name, business_date,
              clock_in_at, clock_out_at, sh_start, sh_end, NULL::int AS minutes
       FROM att WHERE clock_out_at IS NULL AND status = 'working'
       UNION ALL
       -- มาสาย
       SELECT 'late', id, shift_id, employee_id, display_name, business_date,
              clock_in_at, clock_out_at, sh_start, sh_end, late_minutes
       FROM att WHERE COALESCE(late_minutes, 0) > 0
       UNION ALL
       -- ออกก่อนเวลากะ
       SELECT 'early_leave', id, shift_id, employee_id, display_name, business_date,
              clock_in_at, clock_out_at, sh_start, sh_end, early_leave_minutes
       FROM att WHERE COALESCE(early_leave_minutes, 0) > 0
       UNION ALL
       -- ทำงานโดยไม่มีกะ
       SELECT 'unscheduled', id, NULL, employee_id, display_name, business_date,
              clock_in_at, clock_out_at, NULL, NULL, NULL
       FROM att WHERE shift_id IS NULL AND clock_out_at IS NOT NULL
       UNION ALL
       -- มีกะแต่ไม่มีเวลาเลย และไม่ได้ลา (ยังไม่ได้กด absent)
       SELECT 'absent', NULL, sh.id, sh.employee_id,
              COALESCE(e.nickname, e.name), sh.business_date,
              NULL, NULL, sh.start_min, sh.end_min, NULL
       FROM shifts sh
       JOIN employees e ON e.id = sh.employee_id
       WHERE sh.user_id = $1 AND sh.business_date BETWEEN $2::date AND $3::date
         AND sh.status IN ('scheduled')
         AND sh.business_date < CURRENT_DATE
         AND NOT EXISTS (
           SELECT 1 FROM attendance a2
           WHERE a2.employee_id = sh.employee_id
             AND a2.business_date = sh.business_date
             AND a2.status <> 'cancelled')
     )
     SELECT ex.kind, ex.attendance_id, ex.shift_id, ex.employee_id,
            ex.employee_name, ex.business_date::text AS business_date,
            ex.clock_in_at::text AS clock_in_at,
            ex.clock_out_at::text AS clock_out_at,
            ex.sh_start AS shift_start_min, ex.sh_end AS shift_end_min,
            ex.minutes,
            EXISTS (
              SELECT 1 FROM payroll_periods p
              WHERE p.user_id = $1 AND p.status = 'posted'
                AND ex.business_date BETWEEN p.period_start AND p.period_end
            ) AS payroll_posted
     FROM ex
     ORDER BY ex.business_date DESC, ex.employee_name`,
    [userId, range.from, range.to],
  );

  return rows.map((r) => ({
    kind: r.kind,
    attendanceId: r.attendance_id,
    shiftId: r.shift_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    businessDate: r.business_date,
    clockInAt: r.clock_in_at,
    clockOutAt: r.clock_out_at,
    shiftStartMin: r.shift_start_min,
    shiftEndMin: r.shift_end_min,
    minutes: r.minutes,
    payrollPosted: r.payroll_posted,
  }));
}
