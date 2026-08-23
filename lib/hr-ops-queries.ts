import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { hashToken } from "@/lib/hr-employee-queries";
import { adjustAttendance } from "@/lib/hr-attendance-queries";

/**
 * Staff Ops (0082) — พักเบรก · แจ้งเวลาไม่ตรง · Checklist · ประกาศ
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) Break V1 บันทึกอย่างเดียว — ไม่หักจาก regular/ot (สเปคกำกับ)
 *    สถานะพัก = break_started_at IS NOT NULL (ไม่แตะ status enum เดิม)
 * 2) คำขอแก้เวลา อนุมัติแล้ววิ่งผ่าน adjustAttendance เดิมเท่านั้น —
 *    เส้น audit เดียว ไม่มีทางลัดแก้เวลา
 * 3) Checklist รายวันสร้างแบบ lazy + ON CONFLICT DO NOTHING —
 *    สองเครื่องเปิดพร้อมกันไม่เบิ้ล
 */

export class BreakStateError extends Error {}
export class ChecklistIncompleteError extends Error {
  constructor(public remaining: number) {
    super("checklist_incomplete");
  }
}
export class CorrectionStateError extends Error {}
export class CorrectionNotFoundError extends Error {}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function employeeByToken(
  token: string,
): Promise<{ id: string; user_id: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
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

// ═══ Break — บันทึกอย่างเดียว ไม่หักเงิน ════════════════════════

export async function staffBreak(
  token: string,
  action: "start" | "end",
): Promise<{ breakStartedAt: string | null; breakMinutes: number } | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  if (action === "start") {
    const { rows } = await pool.query<{ break_started_at: string }>(
      `UPDATE attendance SET break_started_at = now(), updated_at = now()
       WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'
         AND break_started_at IS NULL
       RETURNING break_started_at::text AS break_started_at`,
      [emp.id],
    );
    if (!rows[0]) throw new BreakStateError();
    await logHr(emp.user_id, "staff", emp.id, "break_started");
    return { breakStartedAt: rows[0].break_started_at, breakMinutes: 0 };
  }

  const { rows } = await pool.query<{ break_minutes: number }>(
    `UPDATE attendance SET
       break_minutes = break_minutes
         + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - break_started_at)) / 60))::int,
       break_started_at = NULL,
       updated_at = now()
     WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'
       AND break_started_at IS NOT NULL
     RETURNING break_minutes`,
    [emp.id],
  );
  if (!rows[0]) throw new BreakStateError();
  await logHr(emp.user_id, "staff", emp.id, "break_ended", {
    breakMinutes: rows[0].break_minutes,
  });
  return { breakStartedAt: null, breakMinutes: rows[0].break_minutes };
}

/** เรียกก่อน clock-out — ถ้ายังพักอยู่ให้ปิดเบรกอัตโนมัติ (เวลาไม่หาย) */
export async function foldOpenBreak(employeeId: string): Promise<void> {
  await pool.query(
    `UPDATE attendance SET
       break_minutes = break_minutes
         + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - break_started_at)) / 60))::int,
       break_started_at = NULL
     WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'
       AND break_started_at IS NOT NULL`,
    [employeeId],
  );
}

/**
 * ด่านก่อน clock-out: งานปิดร้านค้างกี่งาน (+ปิดเบรกที่ค้างให้เรียบร้อย)
 * force = true → บันทึก override พร้อมเหตุผลลง audit แล้วปล่อยผ่าน
 */
export async function staffClosingGate(
  token: string,
  opts: { force?: boolean; overrideReason?: string | null },
): Promise<{ ok: boolean; remaining: number } | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  await foldOpenBreak(emp.id);
  const bizDate = businessDate(await getDayCutoffHour(emp.user_id));
  const remaining = await closingRemaining(emp.user_id, bizDate);
  if (remaining === 0) return { ok: true, remaining: 0 };
  if (!opts.force) return { ok: false, remaining };
  await logHr(emp.user_id, "staff", emp.id, "checklist_override", {
    remaining,
    reason: opts.overrideReason?.trim() || "ไม่ระบุ",
    businessDate: bizDate,
  });
  return { ok: true, remaining };
}

// ═══ Checklist ═══════════════════════════════════════════════════

export type ChecklistPhase = "opening" | "during" | "closing";

export type ChecklistItemView = {
  itemId: string;
  templateId: string;
  phase: ChecklistPhase;
  title: string;
  status: "pending" | "in_progress" | "completed" | "verified";
  completedByName: string | null;
};

/** สร้างรายการของวันนี้จาก template (lazy · กันเบิ้ลด้วย unique) แล้วคืนทั้งชุด */
export async function ensureTodayChecklist(
  userId: string,
  bizDate: string,
): Promise<ChecklistItemView[]> {
  await pool.query(
    `INSERT INTO shift_checklist_items (user_id, template_id, business_date)
     SELECT $1, id, $2::date FROM shift_checklists
     WHERE user_id = $1 AND is_active
     ON CONFLICT (template_id, business_date) DO NOTHING`,
    [userId, bizDate],
  );
  const { rows } = await pool.query<{
    item_id: string; template_id: string; phase: ChecklistPhase; title: string;
    status: ChecklistItemView["status"]; completed_by_name: string | null;
  }>(
    `SELECT i.id AS item_id, c.id AS template_id, c.phase, c.title, i.status,
            COALESCE(e.nickname, e.name) AS completed_by_name
     FROM shift_checklist_items i
     JOIN shift_checklists c ON c.id = i.template_id
     LEFT JOIN employees e ON e.id = i.completed_by
     WHERE i.user_id = $1 AND i.business_date = $2::date AND c.is_active
     ORDER BY c.phase, c.sort_order`,
    [userId, bizDate],
  );
  return rows.map((r) => ({
    itemId: r.item_id,
    templateId: r.template_id,
    phase: r.phase,
    title: r.title,
    status: r.status,
    completedByName: r.completed_by_name,
  }));
}

export async function staffChecklist(token: string): Promise<{
  businessDate: string;
  items: ChecklistItemView[];
} | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const bizDate = businessDate(await getDayCutoffHour(emp.user_id));
  return { businessDate: bizDate, items: await ensureTodayChecklist(emp.user_id, bizDate) };
}

/** ติ๊ก/ยกเลิกติ๊ก — verified แล้วห้ามแตะ (ของ Manager) */
export async function staffToggleChecklistItem(
  token: string,
  itemId: string,
  done: boolean,
): Promise<boolean | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const { rowCount } = await pool.query(
    `UPDATE shift_checklist_items SET
       status = $3, completed_at = CASE WHEN $4 THEN now() END,
       completed_by = CASE WHEN $4 THEN $2::uuid END,
       updated_at = now()
     WHERE id = $1 AND user_id = (SELECT user_id FROM employees WHERE id = $2)
       AND status <> 'verified'`,
    [itemId, emp.id, done ? "completed" : "pending", done],
  );
  return (rowCount ?? 0) > 0;
}

/** งานปิดร้านที่ยังไม่เสร็จของวันนี้ — ใช้เป็นด่านก่อน clock-out */
export async function closingRemaining(userId: string, bizDate: string): Promise<number> {
  await ensureTodayChecklist(userId, bizDate);
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM shift_checklist_items i
     JOIN shift_checklists c ON c.id = i.template_id
     WHERE i.user_id = $1 AND i.business_date = $2::date
       AND c.phase = 'closing' AND c.is_active
       AND i.status IN ('pending', 'in_progress')`,
    [userId, bizDate],
  );
  return rows[0]?.n ?? 0;
}

// ── owner: จัดการ template ──

export type ChecklistTemplate = {
  id: string;
  phase: ChecklistPhase;
  title: string;
  sortOrder: number;
  isActive: boolean;
};

export async function listChecklistTemplates(userId: string): Promise<ChecklistTemplate[]> {
  const { rows } = await pool.query<{
    id: string; phase: ChecklistPhase; title: string; sort_order: number; is_active: boolean;
  }>(
    `SELECT id, phase, title, sort_order, is_active FROM shift_checklists
     WHERE user_id = $1 ORDER BY phase, sort_order`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, phase: r.phase, title: r.title, sortOrder: r.sort_order, isActive: r.is_active,
  }));
}

export async function createChecklistTemplate(
  userId: string,
  input: { phase: ChecklistPhase; title: string },
): Promise<ChecklistTemplate> {
  const { rows } = await pool.query<{ id: string; sort_order: number }>(
    `INSERT INTO shift_checklists (user_id, phase, title, sort_order)
     VALUES ($1, $2, $3,
       (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM shift_checklists
        WHERE user_id = $1 AND phase = $2))
     RETURNING id, sort_order`,
    [userId, input.phase, input.title.trim()],
  );
  return {
    id: rows[0].id, phase: input.phase, title: input.title.trim(),
    sortOrder: rows[0].sort_order, isActive: true,
  };
}

export async function updateChecklistTemplate(
  userId: string,
  id: string,
  input: { title?: string; isActive?: boolean },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE shift_checklists SET
       title = COALESCE($3, title), is_active = COALESCE($4, is_active),
       updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, id, input.title?.trim() ?? null, input.isActive ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/** ภาพรวมวันนี้สำหรับ owner (done/total ต่อ phase) */
export async function checklistSummary(
  userId: string,
  bizDate: string,
): Promise<{ phase: ChecklistPhase; done: number; total: number }[]> {
  const items = await ensureTodayChecklist(userId, bizDate);
  const phases: ChecklistPhase[] = ["opening", "during", "closing"];
  return phases
    .map((phase) => {
      const of = items.filter((i) => i.phase === phase);
      return {
        phase,
        done: of.filter((i) => i.status === "completed" || i.status === "verified").length,
        total: of.length,
      };
    })
    .filter((p) => p.total > 0);
}

// ═══ แจ้งเวลาไม่ตรง (Attendance Correction) ═════════════════════

export type CorrectionRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  kind: "missing_clock_out" | "wrong_time" | "other";
  requestedClockInAt: string | null;
  requestedClockOutAt: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
};

const CORRECTION_SELECT = `
  r.id, r.employee_id, COALESCE(e.nickname, e.name) AS employee_name,
  r.business_date::text AS business_date, r.kind,
  r.requested_clock_in_at::text AS requested_clock_in_at,
  r.requested_clock_out_at::text AS requested_clock_out_at,
  r.note, r.status, r.review_note, r.created_at::text AS created_at
  FROM attendance_correction_requests r
  JOIN employees e ON e.id = r.employee_id`;

type CorrRow = {
  id: string; employee_id: string; employee_name: string; business_date: string;
  kind: CorrectionRequest["kind"]; requested_clock_in_at: string | null;
  requested_clock_out_at: string | null; note: string | null;
  status: CorrectionRequest["status"]; review_note: string | null; created_at: string;
};

const mapCorr = (r: CorrRow): CorrectionRequest => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  businessDate: r.business_date,
  kind: r.kind,
  requestedClockInAt: r.requested_clock_in_at,
  requestedClockOutAt: r.requested_clock_out_at,
  note: r.note,
  status: r.status,
  reviewNote: r.review_note,
  createdAt: r.created_at,
});

export async function staffCreateCorrection(
  token: string,
  input: {
    businessDate: string;
    kind: CorrectionRequest["kind"];
    requestedClockInAt?: string | null;
    requestedClockOutAt?: string | null;
    note?: string | null;
  },
): Promise<CorrectionRequest | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  // ผูกกับแถว attendance ของวันนั้น (ถ้ามี) — แถว cancelled ไม่นับ
  const { rows: att } = await pool.query<{ id: string }>(
    `SELECT id FROM attendance
     WHERE employee_id = $1 AND business_date = $2::date AND status <> 'cancelled'
     ORDER BY clock_in_at DESC LIMIT 1`,
    [emp.id, input.businessDate],
  );

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO attendance_correction_requests
       (user_id, employee_id, attendance_id, business_date, kind,
        requested_clock_in_at, requested_clock_out_at, note)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
     RETURNING id`,
    [emp.user_id, emp.id, att[0]?.id ?? null, input.businessDate, input.kind,
     input.requestedClockInAt ?? null, input.requestedClockOutAt ?? null,
     input.note?.trim() || null],
  );
  await logHr(emp.user_id, "staff", emp.id, "correction_requested", {
    correctionId: rows[0].id, businessDate: input.businessDate, kind: input.kind,
  });
  const { rows: out } = await pool.query<CorrRow>(
    `SELECT ${CORRECTION_SELECT} WHERE r.id = $1`,
    [rows[0].id],
  );
  return mapCorr(out[0]);
}

export async function staffListCorrections(
  token: string,
): Promise<CorrectionRequest[] | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const { rows } = await pool.query<CorrRow>(
    `SELECT ${CORRECTION_SELECT} WHERE r.employee_id = $1
     ORDER BY r.created_at DESC LIMIT 10`,
    [emp.id],
  );
  return rows.map(mapCorr);
}

export async function listCorrections(
  userId: string,
  status?: CorrectionRequest["status"],
): Promise<CorrectionRequest[]> {
  const { rows } = await pool.query<CorrRow>(
    `SELECT ${CORRECTION_SELECT}
     WHERE r.user_id = $1 ${status ? "AND r.status = $2" : ""}
     ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 100`,
    status ? [userId, status] : [userId],
  );
  return rows.map(mapCorr);
}

/**
 * อนุมัติ = ปรับเวลาผ่าน adjustAttendance เดิม (Phase 2) —
 * ได้ attendance_adjustments + audit + recalc ชั่วโมง/late/early ครบชุด
 */
export async function reviewCorrection(
  userId: string,
  correctionId: string,
  input: { decision: "approve" | "reject"; note?: string | null },
): Promise<CorrectionRequest> {
  const { rows: cur } = await pool.query<{
    employee_id: string; attendance_id: string | null; status: string;
    kind: string; note: string | null;
    requested_clock_in_at: string | null; requested_clock_out_at: string | null;
  }>(
    `SELECT employee_id, attendance_id, status, kind, note,
            requested_clock_in_at::text AS requested_clock_in_at,
            requested_clock_out_at::text AS requested_clock_out_at
     FROM attendance_correction_requests
     WHERE user_id = $1 AND id = $2`,
    [userId, correctionId],
  );
  if (!cur[0]) throw new CorrectionNotFoundError();
  if (cur[0].status !== "pending") throw new CorrectionStateError();

  if (input.decision === "approve") {
    if (!cur[0].attendance_id) throw new CorrectionStateError(); // ไม่มีแถวให้แก้
    await adjustAttendance(userId, cur[0].attendance_id, {
      clockInAt: cur[0].requested_clock_in_at ?? undefined,
      clockOutAt:
        cur[0].requested_clock_out_at === null
          ? undefined
          : cur[0].requested_clock_out_at,
      reason: `คำขอพนักงาน: ${cur[0].note ?? cur[0].kind}`.slice(0, 255),
    });
  }

  await pool.query(
    `UPDATE attendance_correction_requests SET
       status = $3, review_note = $4, reviewed_at = now(), updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, correctionId, input.decision === "approve" ? "approved" : "rejected",
     input.note?.trim() || (input.decision === "reject" ? "ไม่ระบุเหตุผล" : null)],
  );
  await logHr(userId, "owner", cur[0].employee_id,
    input.decision === "approve" ? "correction_approved" : "correction_rejected",
    { correctionId });

  const { rows: out } = await pool.query<CorrRow>(
    `SELECT ${CORRECTION_SELECT} WHERE r.id = $1`,
    [correctionId],
  );
  return mapCorr(out[0]);
}

// ═══ ประกาศ ══════════════════════════════════════════════════════

export type Announcement = { id: string; body: string; isActive: boolean; createdAt: string };

export async function listAnnouncements(
  userId: string,
  activeOnly: boolean,
): Promise<Announcement[]> {
  const { rows } = await pool.query<{
    id: string; body: string; is_active: boolean; created_at: string;
  }>(
    `SELECT id, body, is_active, created_at::text AS created_at
     FROM shop_announcements
     WHERE user_id = $1 ${activeOnly ? "AND is_active" : ""}
     ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, body: r.body, isActive: r.is_active, createdAt: r.created_at,
  }));
}

export async function createAnnouncement(userId: string, body: string): Promise<void> {
  await pool.query(
    `INSERT INTO shop_announcements (user_id, body) VALUES ($1, $2)`,
    [userId, body.trim().slice(0, 500)],
  );
}

export async function setAnnouncementActive(
  userId: string,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE shop_announcements SET is_active = $3 WHERE id = $2 AND user_id = $1`,
    [userId, id, isActive],
  );
  return (rowCount ?? 0) > 0;
}
