import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * HR Phase 2 (0078) — ลงเวลาเข้า-ออกงาน
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) เวลาเป็นของ server: clock in/out ใช้ now() ของ DB — client ส่งได้แค่
 *    "การกด" ไม่ใช่เวลา (มือถือพนักงานปรับนาฬิกาเอง = ไร้ผล)
 * 2) กันกดซ้อนที่ DB: idx_attendance_open_once — จับ 23505 ด้วยชื่อ index
 *    ไม่ใช่ SELECT-แล้ว-INSERT (race กด 2 เครื่องพร้อมกันก็รอด)
 * 3) business_date = ตัวเดียวกับบิล (businessDate + getDayCutoffHour)
 *    ร้านปิดตี 1 → clock out หลังเที่ยงคืนยังนับกะของเมื่อวาน
 * 4) แก้มือ = attendance_adjustments (ค่าเดิม/ใหม่/เหตุผล) + audit เสมอ
 * 5) OT split ตาม hr_settings.standard_day_minutes — ไม่ hardcode
 */

// ── errors (route แปลงเป็น 4xx) ────────────────────────────────

export class AlreadyWorkingError extends Error {}
export class NoActiveAttendanceError extends Error {}
export class AttendanceNotFoundError extends Error {}

// ── types ──────────────────────────────────────────────────────

export type AttendanceStatus = "working" | "completed" | "adjusted" | "cancelled";

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  branchId: string | null;
  branchName: string | null;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  totalMinutes: number | null;
  regularMinutes: number | null;
  otMinutes: number | null;
  status: AttendanceStatus;
  source: "staff_link" | "manager" | "system";
  note: string | null;
  adjustments: number;
};

export type StaffAttendanceView = {
  /** แถวที่ยังไม่ปิดของวันนี้ (ถ้ามี = กำลังทำงาน) */
  active: { id: string; clockInAt: string; businessDate: string } | null;
  /** ประวัติ 7 วันขายล่าสุด (รวมวันนี้) — เฉพาะของตัวเอง */
  recent: {
    businessDate: string;
    clockInAt: string;
    clockOutAt: string | null;
    totalMinutes: number | null;
    otMinutes: number | null;
    status: AttendanceStatus;
  }[];
};

export type AttendanceSummary = {
  date: string;
  working: number;
  completed: number;
  notStarted: number;
  totalMinutes: number;
  totalOtMinutes: number;
};

// ── internal ───────────────────────────────────────────────────

type StaffEmployee = { id: string; user_id: string; branch_id: string | null };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** resolve พนักงานจาก token — เงื่อนไขเดียวกับหน้าโปรไฟล์เป๊ะ (active + ไม่หมดอายุ) */
async function employeeByToken(token: string): Promise<StaffEmployee | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<StaffEmployee>(
    `SELECT id, user_id, branch_id FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

async function standardDayMinutes(userId: string): Promise<number> {
  const { rows } = await pool.query<{ standard_day_minutes: number }>(
    `SELECT standard_day_minutes FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  const v = Number(rows[0]?.standard_day_minutes ?? 480);
  return Number.isFinite(v) && v > 0 ? v : 480;
}

function splitMinutes(total: number, std: number) {
  return {
    total,
    regular: Math.min(total, std),
    ot: Math.max(0, total - std),
  };
}

async function logHr(
  userId: string,
  actor: "owner" | "staff",
  employeeId: string | null,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, actor, employeeId, action, detail ? JSON.stringify(detail) : null],
  );
}

function isOpenOnceViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string };
  return (
    e.code === "23505" &&
    (e.constraint === "idx_attendance_open_once" ||
      (e.message ?? "").includes("idx_attendance_open_once"))
  );
}

// ── staff actions (token) ──────────────────────────────────────

/** CLOCK IN — server ตัดสินทุกอย่าง: เวลา, วันขาย, สาขา */
export async function staffClockIn(
  token: string,
): Promise<{ id: string; clockInAt: string; businessDate: string } | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null; // token ผิด/หมดอายุ/ไม่ active → 404 เดียว

  const bizDate = businessDate(await getDayCutoffHour(emp.user_id));
  try {
    const { rows } = await pool.query<{ id: string; clock_in_at: string }>(
      `INSERT INTO attendance
         (user_id, employee_id, branch_id, business_date, clock_in_at, status, source)
       VALUES ($1, $2, $3, $4::date, now(), 'working', 'staff_link')
       RETURNING id, clock_in_at::text AS clock_in_at`,
      [emp.user_id, emp.id, emp.branch_id, bizDate],
    );
    await logHr(emp.user_id, "staff", emp.id, "clock_in", { businessDate: bizDate });
    return { id: rows[0].id, clockInAt: rows[0].clock_in_at, businessDate: bizDate };
  } catch (err) {
    if (isOpenOnceViolation(err)) throw new AlreadyWorkingError();
    throw err;
  }
}

/** CLOCK OUT — ปิดแถวที่เปิดอยู่ด้วย now() + คำนวณชั่วโมง/OT ใน UPDATE เดียว */
export async function staffClockOut(token: string): Promise<{
  clockInAt: string;
  clockOutAt: string;
  totalMinutes: number;
  otMinutes: number;
} | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const std = await standardDayMinutes(emp.user_id);
  // atomic: เงื่อนไข "ยังเปิดอยู่" อยู่ใน WHERE — กดซ้ำสองเครื่อง เครื่องที่สองได้ 0 แถว
  const { rows } = await pool.query<{
    clock_in_at: string;
    clock_out_at: string;
    total_minutes: number;
  }>(
    `UPDATE attendance SET
       clock_out_at    = now(),
       total_minutes   = FLOOR(EXTRACT(EPOCH FROM (now() - clock_in_at)) / 60),
       regular_minutes = LEAST(FLOOR(EXTRACT(EPOCH FROM (now() - clock_in_at)) / 60), $2),
       ot_minutes      = GREATEST(FLOOR(EXTRACT(EPOCH FROM (now() - clock_in_at)) / 60) - $2, 0),
       status          = 'completed',
       updated_at      = now()
     WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'
     RETURNING clock_in_at::text AS clock_in_at,
               clock_out_at::text AS clock_out_at, total_minutes`,
    [emp.id, std],
  );
  if (!rows[0]) throw new NoActiveAttendanceError();

  const { total, ot } = splitMinutes(rows[0].total_minutes, std);
  await logHr(emp.user_id, "staff", emp.id, "clock_out", { totalMinutes: total });
  return {
    clockInAt: rows[0].clock_in_at,
    clockOutAt: rows[0].clock_out_at,
    totalMinutes: total,
    otMinutes: ot,
  };
}

/** เวลาของฉัน — active วันนี้ + ย้อนหลัง 7 วันขาย (เฉพาะตัวเอง) */
export async function staffAttendance(token: string): Promise<StaffAttendanceView | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const [{ rows: open }, { rows: recent }] = await Promise.all([
    pool.query<{ id: string; clock_in_at: string; business_date: string }>(
      `SELECT id, clock_in_at::text AS clock_in_at, business_date::text AS business_date
       FROM attendance
       WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'`,
      [emp.id],
    ),
    pool.query<{
      business_date: string;
      clock_in_at: string;
      clock_out_at: string | null;
      total_minutes: number | null;
      ot_minutes: number | null;
      status: AttendanceStatus;
    }>(
      `SELECT business_date::text AS business_date, clock_in_at::text AS clock_in_at,
              clock_out_at::text AS clock_out_at, total_minutes, ot_minutes, status
       FROM attendance
       WHERE employee_id = $1 AND status <> 'cancelled'
         AND business_date >= CURRENT_DATE - 8
       ORDER BY clock_in_at DESC
       LIMIT 20`,
      [emp.id],
    ),
  ]);

  return {
    active: open[0]
      ? {
          id: open[0].id,
          clockInAt: open[0].clock_in_at,
          businessDate: open[0].business_date,
        }
      : null,
    recent: recent.map((r) => ({
      businessDate: r.business_date,
      clockInAt: r.clock_in_at,
      clockOutAt: r.clock_out_at,
      totalMinutes: r.total_minutes,
      otMinutes: r.ot_minutes,
      status: r.status,
    })),
  };
}

// ── owner ──────────────────────────────────────────────────────

const RECORD_SELECT = `
  a.id, a.employee_id, e.name AS employee_name, e.nickname AS employee_nickname,
  a.branch_id, b.name AS branch_name,
  a.business_date::text AS business_date,
  a.clock_in_at::text AS clock_in_at, a.clock_out_at::text AS clock_out_at,
  a.total_minutes, a.regular_minutes, a.ot_minutes, a.status, a.source, a.note,
  (SELECT COUNT(*)::int FROM attendance_adjustments adj
   WHERE adj.attendance_id = a.id) AS adjustments
  FROM attendance a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN branches b ON b.id = a.branch_id`;

type RecordRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  branch_id: string | null;
  branch_name: string | null;
  business_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  total_minutes: number | null;
  regular_minutes: number | null;
  ot_minutes: number | null;
  status: AttendanceStatus;
  source: "staff_link" | "manager" | "system";
  note: string | null;
  adjustments: number;
};

function mapRecord(r: RecordRow): AttendanceRecord {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeNickname: r.employee_nickname,
    branchId: r.branch_id,
    branchName: r.branch_name,
    businessDate: r.business_date,
    clockInAt: r.clock_in_at,
    clockOutAt: r.clock_out_at,
    totalMinutes: r.total_minutes,
    regularMinutes: r.regular_minutes,
    otMinutes: r.ot_minutes,
    status: r.status,
    source: r.source,
    note: r.note,
    adjustments: r.adjustments,
  };
}

export type AttendanceFilter = {
  date?: string;        // YYYY-MM-DD (default: วันขายวันนี้)
  employeeId?: string;
  branchId?: string;
  status?: AttendanceStatus;
};

export async function listAttendance(
  userId: string,
  filter: AttendanceFilter,
): Promise<{ date: string; records: AttendanceRecord[]; summary: AttendanceSummary }> {
  const date = filter.date ?? businessDate(await getDayCutoffHour(userId));

  const conds = ["a.user_id = $1", "a.business_date = $2::date"];
  const params: string[] = [userId, date];
  let i = 3;
  if (filter.employeeId) {
    conds.push(`a.employee_id = $${i}`);
    params.push(filter.employeeId);
    i += 1;
  }
  if (filter.branchId) {
    conds.push(`a.branch_id = $${i}`);
    params.push(filter.branchId);
    i += 1;
  }
  if (filter.status) {
    conds.push(`a.status = $${i}`);
    params.push(filter.status);
    i += 1;
  }

  const [{ rows }, { rows: staffCount }] = await Promise.all([
    pool.query<RecordRow>(
      `SELECT ${RECORD_SELECT} WHERE ${conds.join(" AND ")}
       ORDER BY a.clock_in_at DESC`,
      params,
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM employees
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    ),
  ]);

  const records = rows.map(mapRecord);
  const usable = records.filter((r) => r.status !== "cancelled");
  const startedIds = new Set(usable.map((r) => r.employeeId));
  const summary: AttendanceSummary = {
    date,
    working: usable.filter((r) => r.status === "working").length,
    completed: usable.filter((r) => r.status !== "working").length,
    notStarted: Math.max(0, (staffCount[0]?.n ?? 0) - startedIds.size),
    totalMinutes: usable.reduce((s, r) => s + (r.totalMinutes ?? 0), 0),
    totalOtMinutes: usable.reduce((s, r) => s + (r.otMinutes ?? 0), 0),
  };
  return { date, records, summary };
}

export async function getAttendance(
  userId: string,
  id: string,
): Promise<AttendanceRecord | null> {
  const { rows } = await pool.query<RecordRow>(
    `SELECT ${RECORD_SELECT} WHERE a.user_id = $1 AND a.id = $2`,
    [userId, id],
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

export type AdjustInput = {
  clockInAt?: string;      // ISO — owner ปรับมือได้ (ลง audit เสมอ)
  clockOutAt?: string | null;
  note?: string | null;
  reason: string;          // บังคับ — ห้ามแก้เงียบ ๆ
  cancel?: boolean;        // ยกเลิกแถว (เช่น กดผิดคน)
};

/** ปรับเวลา/ยกเลิก — เก็บค่าเดิม+ใหม่+เหตุผล และคำนวณชั่วโมงใหม่ตาม settings */
export async function adjustAttendance(
  userId: string,
  id: string,
  input: AdjustInput,
): Promise<AttendanceRecord> {
  const before = await getAttendance(userId, id);
  if (!before) throw new AttendanceNotFoundError();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (input.cancel) {
      await client.query(
        `UPDATE attendance SET status = 'cancelled', note = COALESCE($3, note),
           updated_at = now()
         WHERE id = $2 AND user_id = $1`,
        [userId, id, input.note ?? null],
      );
    } else {
      const newIn = input.clockInAt ?? before.clockInAt;
      const newOut =
        input.clockOutAt === undefined ? before.clockOutAt : input.clockOutAt;
      const std = await standardDayMinutes(userId);
      await client.query(
        `UPDATE attendance SET
           clock_in_at  = $3::timestamptz,
           clock_out_at = $4::timestamptz,
           total_minutes = CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE
             GREATEST(FLOOR(EXTRACT(EPOCH FROM ($4::timestamptz - $3::timestamptz)) / 60), 0) END,
           regular_minutes = CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE
             LEAST(GREATEST(FLOOR(EXTRACT(EPOCH FROM ($4::timestamptz - $3::timestamptz)) / 60), 0), $5) END,
           ot_minutes = CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE
             GREATEST(GREATEST(FLOOR(EXTRACT(EPOCH FROM ($4::timestamptz - $3::timestamptz)) / 60), 0) - $5, 0) END,
           status = CASE WHEN $4::timestamptz IS NULL THEN 'working' ELSE 'adjusted' END,
           note = COALESCE($6, note),
           updated_at = now()
         WHERE id = $2 AND user_id = $1`,
        [userId, id, newIn, newOut, std, input.note ?? null],
      );
    }

    const after = (await getAttendance(userId, id))!;
    await client.query(
      `INSERT INTO attendance_adjustments
         (user_id, attendance_id, actor, before, after, reason)
       VALUES ($1, $2, 'owner', $3, $4, $5)`,
      [
        userId,
        id,
        JSON.stringify({
          clockInAt: before.clockInAt,
          clockOutAt: before.clockOutAt,
          totalMinutes: before.totalMinutes,
          status: before.status,
        }),
        JSON.stringify({
          clockInAt: after.clockInAt,
          clockOutAt: after.clockOutAt,
          totalMinutes: after.totalMinutes,
          status: after.status,
        }),
        input.reason.trim(),
      ],
    );
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'owner', $2, 'attendance_adjusted', $3)`,
      [
        userId,
        before.employeeId,
        JSON.stringify({ attendanceId: id, reason: input.reason.trim() }),
      ],
    );
    await client.query("COMMIT");
    return after;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
