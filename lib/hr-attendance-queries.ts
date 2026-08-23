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
/** ร้านปิด walk-in (allow_unscheduled_clock_in = false) และวันนี้ไม่มีกะ */
export class NoShiftError extends Error {}

// ── types ──────────────────────────────────────────────────────

/** 'leave' = แถวที่ระบบสร้างจากใบลาที่อนุมัติ (0081) — ไม่มีการกดเวลา */
export type AttendanceStatus =
  | "working"
  | "completed"
  | "adjusted"
  | "cancelled"
  | "leave";

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
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  shiftId: string | null;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
};

export type StaffAttendanceView = {
  /** แถวที่ยังไม่ปิดของวันนี้ (ถ้ามี = กำลังทำงาน) */
  active: {
    id: string;
    clockInAt: string;
    businessDate: string;
    lateMinutes: number | null;
  } | null;
  /** กะของฉันวันนี้ (Phase 3) — null = ไม่มีตารางงาน */
  todayShift: {
    startMin: number;
    endMin: number;
    status: string;
    branchName: string | null;
  } | null;
  /** ร้านอนุญาตให้ลงเวลาแบบไม่มีกะไหม (จาก hr_settings) */
  allowUnscheduledClockIn: boolean;
  /** ประวัติ 7 วันขายล่าสุด (รวมวันนี้) — เฉพาะของตัวเอง */
  recent: {
    businessDate: string;
    clockInAt: string;
    clockOutAt: string | null;
    totalMinutes: number | null;
    otMinutes: number | null;
    lateMinutes: number | null;
    earlyLeaveMinutes: number | null;
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
  // Phase 3: เทียบแผนกับจริง
  scheduledShifts: number;
  absentShifts: number;
  scheduledMinutes: number;
  /** actual ÷ scheduled (%) — null เมื่อไม่มีตารางกะวันนั้น */
  coveragePct: string | null;
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

async function hrClockSettings(userId: string): Promise<{
  graceMinutes: number;
  allowUnscheduled: boolean;
}> {
  const { rows } = await pool.query<{
    late_grace_minutes: number;
    allow_unscheduled_clock_in: boolean;
  }>(
    `SELECT late_grace_minutes, allow_unscheduled_clock_in
     FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    graceMinutes: Number(rows[0]?.late_grace_minutes ?? 5),
    allowUnscheduled: rows[0]?.allow_unscheduled_clock_in ?? true,
  };
}

/**
 * เวลาตามกะเป็น instant จริง (โซนไทย):
 *   start = business_date + start_min · ถ้า start_min < cutoff×60 แปลว่ากะ
 *   เริ่มหลังเที่ยงคืน (เป็นเช้าวันปฏิทินถัดไปของวันขายเดิม) → +1 วัน
 *   end = start + ระยะกะ (end_min ข้ามเที่ยงคืนได้)
 * คำนวณใน SQL ทั้งหมด — เข็มนาฬิกาเดียวกับ now() ของ DB
 */
const SHIFT_INSTANT_SQL = `
  ((sh.business_date::timestamp + make_interval(mins => sh.start_min::int)
    + CASE WHEN sh.start_min < $CUTOFF * 60 THEN interval '1 day' ELSE interval '0' END)
   AT TIME ZONE 'Asia/Bangkok')`;

type TodayShiftRow = {
  id: string;
  start_min: number;
  end_min: number;
  break_minutes: number;
  status: string;
  sched_start: string;
  sched_end: string;
  late_now: number;
};

/** กะของวันขายนี้ที่ยังไม่ถูกใช้ลงเวลา — เลือกกะที่เริ่มเช้าสุดก่อน */
async function findTodayShift(
  client: { query: typeof pool.query },
  employeeId: string,
  bizDate: string,
  cutoff: number,
): Promise<TodayShiftRow | null> {
  const startExpr = SHIFT_INSTANT_SQL.replace(/\$CUTOFF/g, "$3");
  const { rows } = await client.query<TodayShiftRow>(
    `SELECT sh.id, sh.start_min, sh.end_min, sh.break_minutes, sh.status,
            ${startExpr}::text AS sched_start,
            (${startExpr} + make_interval(mins =>
               (CASE WHEN sh.end_min <= sh.start_min THEN sh.end_min + 1440
                     ELSE sh.end_min END - sh.start_min)::int))::text AS sched_end,
            FLOOR(EXTRACT(EPOCH FROM (now() - ${startExpr})) / 60)::int AS late_now
     FROM shifts sh
     WHERE sh.employee_id = $1 AND sh.business_date = $2::date
       AND sh.status IN ('scheduled', 'working')
       AND NOT EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.shift_id = sh.id AND a.status <> 'cancelled')
     ORDER BY sh.start_min
     LIMIT 1`,
    [employeeId, bizDate, String(cutoff)],
  );
  return rows[0] ?? null;
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

/**
 * CLOCK IN — server ตัดสินทุกอย่าง: เวลา, วันขาย, สาขา, กะ, มาสาย
 *
 * มีกะวันนี้ → ผูก shift_id + คิด late เทียบ grace + กะเป็น working
 * ไม่มีกะ → walk-in (shift_id/late = NULL) ถ้าร้านอนุญาต ไม่งั้น NoShiftError
 *
 * late behavior (เลือกและล็อกไว้): ภายใน grace = ตรงเวลา (0) ·
 * เกิน grace = สายเต็มจำนวนนาทีจริง (ไม่หัก grace) — grace คือช่วงอภัย
 * ไม่ใช่ส่วนลด
 */
export async function staffClockIn(token: string): Promise<{
  id: string;
  clockInAt: string;
  businessDate: string;
  lateMinutes: number | null;
} | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null; // token ผิด/หมดอายุ/ไม่ active → 404 เดียว

  const cutoff = await getDayCutoffHour(emp.user_id);
  const bizDate = businessDate(cutoff);
  const { graceMinutes, allowUnscheduled } = await hrClockSettings(emp.user_id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const shift = await findTodayShift(client, emp.id, bizDate, cutoff);
    if (!shift && !allowUnscheduled) throw new NoShiftError();

    const late =
      shift === null ? null : shift.late_now > graceMinutes ? Math.max(0, shift.late_now) : 0;

    const { rows } = await client.query<{ id: string; clock_in_at: string }>(
      `INSERT INTO attendance
         (user_id, employee_id, branch_id, business_date, clock_in_at,
          status, source, shift_id, late_minutes)
       VALUES ($1, $2, $3, $4::date, now(), 'working', 'staff_link', $5, $6)
       RETURNING id, clock_in_at::text AS clock_in_at`,
      [emp.user_id, emp.id, emp.branch_id, bizDate, shift?.id ?? null, late],
    );
    if (shift) {
      await client.query(
        `UPDATE shifts SET status = 'working', updated_at = now()
         WHERE id = $1 AND status = 'scheduled'`,
        [shift.id],
      );
    }
    await client.query("COMMIT");
    await logHr(emp.user_id, "staff", emp.id, "clock_in", {
      businessDate: bizDate,
      shiftId: shift?.id ?? null,
      lateMinutes: late,
    });
    return {
      id: rows[0].id,
      clockInAt: rows[0].clock_in_at,
      businessDate: bizDate,
      lateMinutes: late,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (isOpenOnceViolation(err)) throw new AlreadyWorkingError();
    throw err;
  } finally {
    client.release();
  }
}

/**
 * CLOCK OUT — ปิดแถวที่เปิดอยู่ด้วย now() + ชั่วโมง/OT ใน UPDATE เดียว
 * มีกะ → คิดออกก่อนเวลา (early leave เก็บเต็มจำนวน ไม่มี grace) + กะเป็น completed
 */
export async function staffClockOut(token: string): Promise<{
  clockInAt: string;
  clockOutAt: string;
  totalMinutes: number;
  otMinutes: number;
  earlyLeaveMinutes: number | null;
} | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const std = await standardDayMinutes(emp.user_id);
  const cutoff = await getDayCutoffHour(emp.user_id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // atomic: เงื่อนไข "ยังเปิดอยู่" อยู่ใน WHERE — กดซ้ำสองเครื่อง เครื่องที่สองได้ 0 แถว
    const { rows } = await client.query<{
      id: string;
      shift_id: string | null;
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
       RETURNING id, shift_id, clock_in_at::text AS clock_in_at,
                 clock_out_at::text AS clock_out_at, total_minutes`,
      [emp.id, std],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      throw new NoActiveAttendanceError();
    }

    let earlyLeave: number | null = null;
    if (rows[0].shift_id) {
      const startExpr = SHIFT_INSTANT_SQL.replace(/\$CUTOFF/g, "$3");
      const { rows: early } = await client.query<{ early: number }>(
        `SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
            (${startExpr} + make_interval(mins =>
               (CASE WHEN sh.end_min <= sh.start_min THEN sh.end_min + 1440
                     ELSE sh.end_min END - sh.start_min)::int))
            - a.clock_out_at)) / 60))::int AS early
         FROM shifts sh
         JOIN attendance a ON a.id = $2
         WHERE sh.id = $1`,
        [rows[0].shift_id, rows[0].id, String(cutoff)],
      );
      earlyLeave = early[0]?.early ?? 0;
      await client.query(
        `UPDATE attendance SET early_leave_minutes = $2 WHERE id = $1`,
        [rows[0].id, earlyLeave],
      );
      await client.query(
        `UPDATE shifts SET status = 'completed', updated_at = now()
         WHERE id = $1 AND status IN ('scheduled', 'working')`,
        [rows[0].shift_id],
      );
    }
    await client.query("COMMIT");

    const { total, ot } = splitMinutes(rows[0].total_minutes, std);
    await logHr(emp.user_id, "staff", emp.id, "clock_out", {
      totalMinutes: total,
      earlyLeaveMinutes: earlyLeave,
    });
    return {
      clockInAt: rows[0].clock_in_at,
      clockOutAt: rows[0].clock_out_at,
      totalMinutes: total,
      otMinutes: ot,
      earlyLeaveMinutes: earlyLeave,
    };
  } catch (err) {
    if (!(err instanceof NoActiveAttendanceError)) await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** เวลาของฉัน — active วันนี้ + กะวันนี้ + ย้อนหลัง 7 วันขาย (เฉพาะตัวเอง) */
export async function staffAttendance(token: string): Promise<StaffAttendanceView | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const cutoff = await getDayCutoffHour(emp.user_id);
  const bizDate = businessDate(cutoff);
  const { allowUnscheduled } = await hrClockSettings(emp.user_id);

  const [{ rows: open }, { rows: recent }, { rows: shiftRows }] = await Promise.all([
    pool.query<{
      id: string; clock_in_at: string; business_date: string; late_minutes: number | null;
    }>(
      `SELECT id, clock_in_at::text AS clock_in_at,
              business_date::text AS business_date, late_minutes
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
      late_minutes: number | null;
      early_leave_minutes: number | null;
      status: AttendanceStatus;
    }>(
      `SELECT business_date::text AS business_date, clock_in_at::text AS clock_in_at,
              clock_out_at::text AS clock_out_at, total_minutes, ot_minutes,
              late_minutes, early_leave_minutes, status
       FROM attendance
       WHERE employee_id = $1 AND status <> 'cancelled'
         AND business_date >= CURRENT_DATE - 8
       ORDER BY clock_in_at DESC
       LIMIT 20`,
      [emp.id],
    ),
    pool.query<{
      start_min: number; end_min: number; status: string; branch_name: string | null;
    }>(
      `SELECT sh.start_min, sh.end_min, sh.status, b.name AS branch_name
       FROM shifts sh LEFT JOIN branches b ON b.id = sh.branch_id
       WHERE sh.employee_id = $1 AND sh.business_date = $2::date
         AND sh.status NOT IN ('cancelled')
       ORDER BY sh.start_min LIMIT 1`,
      [emp.id, bizDate],
    ),
  ]);

  return {
    active: open[0]
      ? {
          id: open[0].id,
          clockInAt: open[0].clock_in_at,
          businessDate: open[0].business_date,
          lateMinutes: open[0].late_minutes,
        }
      : null,
    todayShift: shiftRows[0]
      ? {
          startMin: shiftRows[0].start_min,
          endMin: shiftRows[0].end_min,
          status: shiftRows[0].status,
          branchName: shiftRows[0].branch_name,
        }
      : null,
    allowUnscheduledClockIn: allowUnscheduled,
    recent: recent.map((r) => ({
      businessDate: r.business_date,
      clockInAt: r.clock_in_at,
      clockOutAt: r.clock_out_at,
      totalMinutes: r.total_minutes,
      otMinutes: r.ot_minutes,
      lateMinutes: r.late_minutes,
      earlyLeaveMinutes: r.early_leave_minutes,
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
  a.late_minutes, a.early_leave_minutes, a.shift_id,
  sh.start_min AS shift_start_min, sh.end_min AS shift_end_min,
  (SELECT COUNT(*)::int FROM attendance_adjustments adj
   WHERE adj.attendance_id = a.id) AS adjustments
  FROM attendance a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN branches b ON b.id = a.branch_id
  LEFT JOIN shifts sh ON sh.id = a.shift_id`;

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
  late_minutes: number | null;
  early_leave_minutes: number | null;
  shift_id: string | null;
  shift_start_min: number | null;
  shift_end_min: number | null;
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
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    shiftId: r.shift_id,
    shiftStartMin: r.shift_start_min,
    shiftEndMin: r.shift_end_min,
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

  const [{ rows }, { rows: staffCount }, { rows: shiftStats }] = await Promise.all([
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
    // แผนของวันนั้น: กะทั้งหมด (ไม่นับ cancelled) + นาทีตามแผน (หัก break)
    pool.query<{ scheduled: number; absent: number; sched_minutes: number }>(
      `SELECT COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS scheduled,
              COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
              COALESCE(SUM(
                CASE WHEN status IN ('cancelled', 'absent') THEN 0 ELSE
                  GREATEST(0, (CASE WHEN end_min <= start_min THEN end_min + 1440
                                    ELSE end_min END) - start_min - break_minutes)
                END), 0)::int AS sched_minutes
       FROM shifts WHERE user_id = $1 AND business_date = $2::date`,
      [userId, date],
    ),
  ]);

  const records = rows.map(mapRecord);
  const usable = records.filter((r) => r.status !== "cancelled");
  const startedIds = new Set(usable.map((r) => r.employeeId));
  const totalMinutes = usable.reduce((s, r) => s + (r.totalMinutes ?? 0), 0);
  const schedMinutes = shiftStats[0]?.sched_minutes ?? 0;
  const summary: AttendanceSummary = {
    date,
    working: usable.filter((r) => r.status === "working").length,
    completed: usable.filter((r) => r.status !== "working").length,
    notStarted: Math.max(0, (staffCount[0]?.n ?? 0) - startedIds.size),
    totalMinutes,
    totalOtMinutes: usable.reduce((s, r) => s + (r.otMinutes ?? 0), 0),
    scheduledShifts: shiftStats[0]?.scheduled ?? 0,
    absentShifts: shiftStats[0]?.absent ?? 0,
    scheduledMinutes: schedMinutes,
    coveragePct:
      schedMinutes > 0 ? ((totalMinutes / schedMinutes) * 100).toFixed(1) : null,
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
