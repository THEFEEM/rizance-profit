import { pool } from "@/lib/db";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * สมุดร้าน (0086) — บันทึกกลางของร้าน + ช่องทางแจ้งปัญหา
 *
 * ═══ กฎตัวตน (สำคัญที่สุดของไฟล์นี้) ═══════════════════════════
 * ระบบมีตัวตน 2 ชนิดที่ห้ามปนกันเด็ดขาด:
 *
 *   created_by_user_id      = บัญชี/เซสชันที่สร้างแถว
 *   reported_by_employee_id = พนักงานตัวจริงที่แจ้ง
 *
 * เครื่อง POS ล็อกอินด้วยบัญชี "เจ้าของ" — พิสูจน์ไม่ได้ว่าพนักงานคนไหนกด
 * จึงบันทึกเป็น source='pos_device' โดยไม่มีตัวตนผู้แจ้ง
 * แอป /e/[token] ผูกกับ employees.id — บันทึกชื่อจริงได้
 *
 * ห้ามเดาชื่อจากคนเข้าเวร · ห้ามใช้บัญชีเจ้าของเป็นผู้แจ้ง
 * (CHECK ใน 0086 บังคับไว้อีกชั้นแล้ว)
 *
 * ═══ การมองเห็น ═══════════════════════════════════════════════
 * เจ้าของเห็นทุกโน้ต · พนักงานเห็นเฉพาะที่ตัวเองแจ้งเท่านั้น
 * โน้ต visibility='owner_manager' ต้องไม่หลุดออกทาง staff endpoint
 * แม้จะยิง API ตรง — บังคับใน SQL ไม่ใช่แค่ซ่อน UI
 */

export type NoteType = "general" | "problem" | "todo" | "reminder" | "idea";
export type NotePriority = "normal" | "important" | "urgent";
export type NoteVisibility = "owner_manager" | "store_team";
export type NoteStatus = "open" | "resolved" | "archived";
export type NoteSource = "owner" | "manager" | "staff_app" | "pos_device";

export type StoreNote = {
  id: string;
  title: string;
  body: string | null;
  type: NoteType;
  priority: NotePriority;
  visibility: NoteVisibility;
  status: NoteStatus;
  source: NoteSource;
  /** ชื่อผู้แจ้ง — null เมื่อพิสูจน์ตัวตนไม่ได้ (แจ้งจากเครื่อง POS) */
  reporterName: string | null;
  reportedByEmployeeId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteRow = {
  id: string; title: string; body: string | null;
  type: NoteType; priority: NotePriority; visibility: NoteVisibility;
  status: NoteStatus; source: NoteSource;
  reporter_name: string | null; reported_by_employee_id: string | null;
  resolved_at: Date | string | null;
  created_at: Date | string; updated_at: Date | string;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

const NOTE_COLS = `id, title, body, type, priority, visibility, status, source,
  reporter_name, reported_by_employee_id, resolved_at, created_at, updated_at`;

function mapNote(r: NoteRow): StoreNote {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    type: r.type,
    priority: r.priority,
    visibility: r.visibility,
    status: r.status,
    source: r.source,
    reporterName: r.reporter_name,
    reportedByEmployeeId: r.reported_by_employee_id,
    resolvedAt: iso(r.resolved_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

/**
 * เรียงแบบที่เจ้าของอยากเห็น: ด่วนที่ยังไม่แก้ขึ้นบนสุดเสมอ
 * แล้วค่อยเรียงตามความสำคัญและเวลา
 */
const NOTE_ORDER = `ORDER BY
  (status = 'open' AND priority = 'urgent') DESC,
  (status = 'open') DESC,
  CASE priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
  created_at DESC`;

// ═══ ฝั่งเจ้าของ ═══════════════════════════════════════════════

export type NoteFilter = {
  status?: NoteStatus;
  type?: NoteType;
  priority?: NotePriority;
};

export async function listNotes(
  userId: string,
  filter: NoteFilter = {},
  limit = 100,
): Promise<{ notes: StoreNote[]; counts: { open: number; urgent: number } }> {
  const where: string[] = ["user_id = $1"];
  const params: (string | number)[] = [userId];
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.type) {
    params.push(filter.type);
    where.push(`type = $${params.length}`);
  }
  if (filter.priority) {
    params.push(filter.priority);
    where.push(`priority = $${params.length}`);
  }
  params.push(Math.min(Math.max(limit, 1), 300));

  const { rows } = await pool.query<NoteRow>(
    `SELECT ${NOTE_COLS} FROM store_notes
     WHERE ${where.join(" AND ")}
     ${NOTE_ORDER}
     LIMIT $${params.length}`,
    params,
  );

  const { rows: c } = await pool.query<{ open: number; urgent: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
            COUNT(*) FILTER (WHERE status = 'open' AND priority = 'urgent')::int AS urgent
     FROM store_notes WHERE user_id = $1`,
    [userId],
  );

  return { notes: rows.map(mapNote), counts: c[0] ?? { open: 0, urgent: 0 } };
}

export async function createNote(
  userId: string,
  input: {
    title: string;
    body?: string | null;
    type?: NoteType;
    priority?: NotePriority;
    visibility?: NoteVisibility;
    /** 'owner' | 'manager' — เขียนเองจากหลังบ้าน */
    source?: Extract<NoteSource, "owner" | "manager">;
  },
): Promise<StoreNote> {
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO store_notes
       (user_id, title, body, type, priority, visibility, source, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $1)
     RETURNING ${NOTE_COLS}`,
    [
      userId,
      input.title.trim(),
      input.body?.trim() || null,
      input.type ?? "general",
      input.priority ?? "normal",
      input.visibility ?? "owner_manager",
      input.source ?? "owner",
    ],
  );
  await logNote(userId, "note_created", { noteId: rows[0].id, type: rows[0].type });
  return mapNote(rows[0]);
}

export async function updateNoteStatus(
  userId: string,
  id: string,
  status: NoteStatus,
): Promise<StoreNote | null> {
  const { rows } = await pool.query<NoteRow>(
    // ⚠️ ต้อง cast $3::text ทุกจุด — พารามิเตอร์เดียวถูกใช้ทั้งเป็นค่าของคอลัมน์
    //    และเทียบกับ literal ถ้าไม่ cast Postgres เดาชนิดไม่ตรงกันแล้ว error
    `UPDATE store_notes SET
       status = $3::text,
       -- CHECK ใน 0086 บังคับว่า resolved ต้องมีเวลาปิดเสมอ
       resolved_at = CASE WHEN $3::text = 'resolved'
                          THEN COALESCE(resolved_at, now()) ELSE NULL END,
       resolved_by_user_id = CASE WHEN $3::text = 'resolved' THEN $1::uuid ELSE NULL END,
       updated_at = now()
     WHERE id = $2 AND user_id = $1
     RETURNING ${NOTE_COLS}`,
    [userId, id, status],
  );
  if (!rows[0]) return null;
  if (status === "resolved") await logNote(userId, "note_resolved", { noteId: id });
  if (status === "archived") await logNote(userId, "note_archived", { noteId: id });
  return mapNote(rows[0]);
}

export async function updateNote(
  userId: string,
  id: string,
  input: {
    title?: string;
    body?: string | null;
    type?: NoteType;
    priority?: NotePriority;
    visibility?: NoteVisibility;
  },
): Promise<StoreNote | null> {
  const { rows } = await pool.query<NoteRow>(
    `UPDATE store_notes SET
       title      = COALESCE($3, title),
       body       = CASE WHEN $4::boolean THEN $5 ELSE body END,
       type       = COALESCE($6, type),
       priority   = COALESCE($7, priority),
       visibility = COALESCE($8, visibility),
       updated_at = now()
     WHERE id = $2 AND user_id = $1
     RETURNING ${NOTE_COLS}`,
    [
      userId,
      id,
      input.title?.trim() || null,
      input.body !== undefined,
      input.body?.trim() || null,
      input.type ?? null,
      input.priority ?? null,
      input.visibility ?? null,
    ],
  );
  return rows[0] ? mapNote(rows[0]) : null;
}

/**
 * แจ้งปัญหาจากเครื่อง POS — พิสูจน์ตัวตนไม่ได้
 *
 * ⚠️ ห้ามใส่ชื่อผู้แจ้งเด็ดขาด แม้จะเดาได้จากคนเข้าเวร
 *    เซสชันของเครื่องคือบัญชีเจ้าของ ไม่ใช่พนักงานที่กำลังกด
 */
export async function reportProblemFromPos(
  userId: string,
  input: { title: string; body?: string | null; priority?: NotePriority },
): Promise<StoreNote> {
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO store_notes
       (user_id, title, body, type, priority, visibility, status, source,
        created_by_user_id)
     VALUES ($1, $2, $3, 'problem', $4, 'store_team', 'open', 'pos_device', $1)
     RETURNING ${NOTE_COLS}`,
    [userId, input.title.trim(), input.body?.trim() || null, input.priority ?? "normal"],
  );
  await logNote(userId, "pos_problem_reported", { noteId: rows[0].id });
  return mapNote(rows[0]);
}

// ═══ ฝั่งพนักงาน (ผ่าน token) ═══════════════════════════════════

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function employeeByToken(
  token: string,
): Promise<{ id: string; user_id: string; name: string; nickname: string | null } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{
    id: string; user_id: string; name: string; nickname: string | null;
  }>(
    `SELECT id, user_id, name, nickname FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/**
 * พนักงานแจ้งปัญหา — ตัวตนมาจาก token เท่านั้น
 * เก็บชื่อเป็น snapshot ไว้ด้วย เผื่อพนักงานลาออกแล้วแถวถูก SET NULL
 */
export async function staffReportProblem(
  token: string,
  input: { title: string; body?: string | null; priority?: NotePriority },
): Promise<StoreNote | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const name = emp.nickname || emp.name;

  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO store_notes
       (user_id, title, body, type, priority, visibility, status, source,
        reported_by_employee_id, reporter_name)
     VALUES ($1, $2, $3, 'problem', $4, 'store_team', 'open', 'staff_app', $5, $6)
     RETURNING ${NOTE_COLS}`,
    [emp.user_id, input.title.trim(), input.body?.trim() || null,
     input.priority ?? "normal", emp.id, name],
  );
  await logNote(emp.user_id, "staff_problem_reported", { noteId: rows[0].id }, emp.id);
  return mapNote(rows[0]);
}

/**
 * "รายการที่ฉันแจ้ง" — เห็นเฉพาะของตัวเองเท่านั้น
 *
 * ⚠️ เงื่อนไข reported_by_employee_id = ตัวเอง คือด่านความปลอดภัยจริง
 *    โน้ตของเจ้าของ (visibility='owner_manager') ไม่มีทางหลุดมาทางนี้
 *    เพราะโน้ตพวกนั้นไม่มีผู้แจ้ง — และเพื่อนร่วมงานก็เห็นของกันไม่ได้
 */
export async function staffMyReports(
  token: string,
  limit = 30,
): Promise<{ reporterName: string; notes: StoreNote[] } | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;
  const { rows } = await pool.query<NoteRow>(
    `SELECT ${NOTE_COLS} FROM store_notes
     WHERE user_id = $1
       AND source = 'staff_app'
       AND reported_by_employee_id = $2
     ${NOTE_ORDER}
     LIMIT $3`,
    [emp.user_id, emp.id, Math.min(Math.max(limit, 1), 100)],
  );
  return { reporterName: emp.nickname || emp.name, notes: rows.map(mapNote) };
}

// ═══ audit ═════════════════════════════════════════════════════

/** reuse ตาราง audit เดิม (ชื่อเป็น hr_ แต่โครงสร้างใช้ได้ทั่วไป) */
async function logNote(
  userId: string,
  action: string,
  detail: Record<string, unknown>,
  employeeId?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, employeeId ? "staff" : "owner", employeeId ?? null, action, JSON.stringify(detail)],
  );
}
