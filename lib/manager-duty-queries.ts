import { pool } from "@/lib/db";
import { businessDate, addDays } from "@/lib/date";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * รอบงานผู้จัดการ (0091)
 *
 * ═══ โมเดล ═══════════════════════════════════════════════════
 * ผู้จัดการไม่ใช่พนักงานกะ — ทำงานเป็น "รอบ": ซื้อของ ตรวจร้าน ตรวจเงิน
 *   เป้า 3 รอบ/สัปดาห์ (อาทิตย์–เสาร์) · ค่าตอบแทน ฿600/สัปดาห์
 *   ตัวเลขสุดท้ายมาจากเจ้าของอนุมัติ ไม่ใช่สูตร — 2/3 รอบไม่ auto เป็น ฿400
 *
 * ═══ กฎที่บังคับที่นี่ (นอกเหนือจาก CHECK ใน 0091) ══════════════
 *   · เปิด/แตะรอบได้เฉพาะ hr_role='manager' ที่พิสูจน์ผ่าน token แล้ว
 *     — client ส่ง isManager มาก็ไม่มีความหมาย เราไม่อ่านมันเลย
 *   · เวลาใน duty ใช้ audit เท่านั้น ไม่มีทางไปแตะเงิน
 *   · ปิดรอบ = snapshot สรุปทั้งรอบ (ผูกกับ CHECK completed→summary)
 */

export class ManagerDutyNotFoundError extends Error {
  constructor() {
    super("manager_duty_not_found");
    this.name = "ManagerDutyNotFoundError";
  }
}
export class ManagerDutyNotOpenError extends Error {
  constructor() {
    super("manager_duty_not_open");
    this.name = "ManagerDutyNotOpenError";
  }
}
export class NotManagerError extends Error {
  constructor() {
    super("not_manager");
    this.name = "NotManagerError";
  }
}
export class DutyItemNotFoundError extends Error {
  constructor() {
    super("duty_item_not_found");
    this.name = "DutyItemNotFoundError";
  }
}
export class DutyReasonRequiredError extends Error {
  constructor() {
    super("duty_reason_required");
    this.name = "DutyReasonRequiredError";
  }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

type ManagerEmp = { id: string; user_id: string; name: string };

/** พิสูจน์ token → ต้องเป็นผู้จัดการที่ active เท่านั้น */
async function managerByToken(token: string): Promise<ManagerEmp | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<ManagerEmp & { hr_role: string }>(
    `SELECT id, user_id, name, hr_role FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  if (!rows[0]) return null;
  if (rows[0].hr_role !== "manager") throw new NotManagerError();
  return rows[0];
}

/** สัปดาห์อาทิตย์–เสาร์ — คืนวันอาทิตย์ที่เริ่ม (ตรงกับ pool/กะเดิม) */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -d.getUTCDay());
}

// ═══ views ═════════════════════════════════════════════════════

export type DutyItemView = {
  id: string;
  title: string;
  status: "pending" | "done" | "not_required" | "issue";
  notRequiredReason: string | null;
  noteId: string | null;
  evidence: Record<string, unknown> | null;
  sortOrder: number;
};

export type DutyView = {
  id: string;
  dutyNo: string;
  businessDate: string;
  status: "open" | "completed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  ownerNote: string | null;
  items: DutyItemView[];
  /** สรุปความคืบหน้า — done + not_required นับเป็น "จัดการแล้ว" */
  progress: { handled: number; total: number; issues: number };
};

export type ManagerWeekView = {
  weekStart: string;
  weekEnd: string;
  dutiesDone: number;
  dutiesTarget: number;
  weeklyWage: string;
  /** รอบของสัปดาห์นี้ เรียงตามวัน */
  duties: { id: string; dutyNo: string; businessDate: string; status: string }[];
  /** รอบที่เปิดค้างของวันนี้ (ถ้ามี) */
  todayDuty: DutyView | null;
};

type DutyRow = {
  id: string;
  duty_no: string;
  business_date: string;
  status: "open" | "completed" | "cancelled";
  started_at: string;
  completed_at: string | null;
  owner_note: string | null;
};

const DUTY_COLS = `id, duty_no, business_date::text AS business_date, status,
  started_at::text AS started_at, completed_at::text AS completed_at, owner_note`;

async function dutyItems(dutyId: string): Promise<DutyItemView[]> {
  const { rows } = await pool.query<{
    id: string; title: string; status: DutyItemView["status"];
    not_required_reason: string | null; note_id: string | null;
    evidence: Record<string, unknown> | null; sort_order: number;
  }>(
    `SELECT id, title, status, not_required_reason, note_id, evidence, sort_order
     FROM manager_duty_items WHERE duty_id = $1 ORDER BY sort_order`,
    [dutyId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    notRequiredReason: r.not_required_reason,
    noteId: r.note_id,
    evidence: r.evidence,
    sortOrder: r.sort_order,
  }));
}

async function mapDuty(r: DutyRow): Promise<DutyView> {
  const items = await dutyItems(r.id);
  return {
    id: r.id,
    dutyNo: r.duty_no,
    businessDate: r.business_date,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    ownerNote: r.owner_note,
    items,
    progress: {
      handled: items.filter((i) => i.status === "done" || i.status === "not_required").length,
      total: items.length,
      issues: items.filter((i) => i.status === "issue").length,
    },
  };
}

// ═══ M4 · Smart Evidence — ระบบยืนยันแทนการติ๊กมือ ═══════════════
//
// หลัก: System Evidence > Manual Checkbox
// ถ้าข้อมูลจริงพิสูจน์ได้ว่างานเกิดขึ้นแล้ว ไม่ต้องให้ผู้จัดการติ๊กซ้ำ
//
// ครอบเฉพาะข้อที่มีหลักฐานจริงในระบบ:
//   "รับของ/บันทึกของเข้า"  ← ใบซื้อ (stock_purchases) ของวันนี้
//   "ทำซอส"                ← ใบผลิต (production_batches) ที่ปิดวันนี้
//   "ตรวจเงินสด"            ← เช็คเงินสดที่ปิดแล้ว (ทำใน completeCashCheck อยู่แล้ว)
// ข้อที่พิสูจน์ไม่ได้ (ความสะอาด/คุณภาพ/อุปกรณ์) ยังเป็นหน้าที่คนติ๊ก — ตั้งใจ
//
// แตะเฉพาะข้อที่ยัง pending — ผู้จัดการติ๊กเอง/ทำเครื่องหมายอื่นไว้ ไม่ทับ

async function applySystemEvidence(userId: string, dutyId: string, date: string): Promise<void> {
  // ── ใบซื้อวันนี้ → "รับของ" + "บันทึกของเข้า" + "ซื้อของ" ──
  const { rows: purchases } = await pool.query<{ n: string; total: string; items: string }>(
    `SELECT COUNT(*)::text AS n, COALESCE(SUM(total), 0)::text AS total,
            COALESCE(SUM((SELECT COUNT(*) FROM stock_purchase_items i
                          WHERE i.purchase_id = p.id)), 0)::text AS items
     FROM stock_purchases p
     WHERE p.user_id = $1 AND p.business_date = $2::date AND p.status = 'received'`,
    [userId, date],
  );
  if (Number(purchases[0].n) > 0) {
    await pool.query(
      // ⚠️ ทุก parameter ต้องถูกอ้างใน SQL — ส่งเกินมา Postgres โยน 42P18
      `UPDATE manager_duty_items SET
         status = 'done',
         evidence = jsonb_build_object(
           'kind', 'purchase',
           'purchases', $2::int, 'items', $3::int, 'total', $4::text),
         updated_at = now()
       WHERE duty_id = $1 AND status = 'pending'
         AND (title LIKE '%ซื้อของ%' OR title LIKE '%รับของ%' OR title LIKE '%ของเข้า%')`,
      [dutyId, Number(purchases[0].n), Number(purchases[0].items), purchases[0].total],
    );
  }

  // ── ใบผลิตที่ปิดวันนี้ → "ทำซอส" ──
  const { rows: batches } = await pool.query<{ n: string; qty: string }>(
    `SELECT COUNT(*)::text AS n, COALESCE(SUM(actual_output_qty), 0)::text AS qty
     FROM production_batches
     WHERE user_id = $1 AND business_date = $2::date AND status = 'completed'`,
    [userId, date],
  );
  if (Number(batches[0].n) > 0) {
    await pool.query(
      `UPDATE manager_duty_items SET
         status = 'done',
         evidence = jsonb_build_object(
           'kind', 'production', 'batches', $2::int, 'outputQty', $3::text),
         updated_at = now()
       WHERE duty_id = $1 AND status = 'pending' AND title LIKE '%ซอส%'`,
      [dutyId, Number(batches[0].n), batches[0].qty],
    );
  }

  // ── เช็คเงินสดปิดแล้ว → "ตรวจเงินสด" ──
  // (completeCashCheck ทำให้ทันทีอยู่แล้ว — ตรงนี้เก็บตกกรณีเช็คปิดก่อนเปิดรอบ)
  const { rows: cash } = await pool.query<{ id: string; difference: string }>(
    `SELECT id, difference::text AS difference FROM daily_cash_checks
     WHERE user_id = $1 AND business_date = $2::date AND status = 'completed'`,
    [userId, date],
  );
  if (cash[0]) {
    await pool.query(
      `UPDATE manager_duty_items SET
         status = 'done',
         evidence = jsonb_build_object(
           'kind', 'cash_check', 'checkId', $2::text, 'difference', $3::text),
         updated_at = now()
       WHERE duty_id = $1 AND status = 'pending' AND title LIKE '%เงินสด%'`,
      [dutyId, cash[0].id, cash[0].difference],
    );
  }
}

// ═══ อ่านสถานะสัปดาห์ (หน้า home ผู้จัดการ) ═════════════════════

export async function managerWeek(token: string): Promise<ManagerWeekView | null> {
  const emp = await managerByToken(token);
  if (!emp) return null;

  const cutoff = await getDayCutoffHour(emp.user_id);
  const today = businessDate(cutoff);
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);

  const [{ rows: settings }, { rows: duties }, { rows: todayRows }] = await Promise.all([
    pool.query<{ manager_weekly_wage: string; manager_weekly_duties: number }>(
      `SELECT manager_weekly_wage::text AS manager_weekly_wage, manager_weekly_duties
       FROM hr_settings WHERE user_id = $1`,
      [emp.user_id],
    ),
    pool.query<{ id: string; duty_no: string; business_date: string; status: string }>(
      `SELECT id, duty_no, business_date::text AS business_date, status
       FROM manager_duties
       WHERE user_id = $1 AND employee_id = $2
         AND business_date BETWEEN $3::date AND $4::date
         AND status <> 'cancelled'
       ORDER BY business_date`,
      [emp.user_id, emp.id, weekStart, weekEnd],
    ),
    pool.query<DutyRow>(
      `SELECT ${DUTY_COLS} FROM manager_duties
       WHERE user_id = $1 AND employee_id = $2 AND business_date = $3::date
         AND status <> 'cancelled'`,
      [emp.user_id, emp.id, today],
    ),
  ]);

  // M4: รอบวันนี้ยังเปิดอยู่ → เก็บหลักฐานจากระบบก่อนส่งให้หน้าจอ
  // (ทุกครั้งที่รีเฟรช — ซื้อของ/ผลิตซอสหลังเปิดรอบก็ถูกติ๊กให้เอง)
  if (todayRows[0] && todayRows[0].status === "open") {
    await applySystemEvidence(emp.user_id, todayRows[0].id, today);
  }

  return {
    weekStart,
    weekEnd,
    dutiesDone: duties.filter((d) => d.status === "completed").length,
    dutiesTarget: settings[0]?.manager_weekly_duties ?? 3,
    weeklyWage: settings[0]?.manager_weekly_wage ?? "600.00",
    duties: duties.map((d) => ({
      id: d.id,
      dutyNo: d.duty_no,
      businessDate: d.business_date,
      status: d.status,
    })),
    todayDuty: todayRows[0] ? await mapDuty(todayRows[0]) : null,
  };
}

// ═══ เปิดรอบ ════════════════════════════════════════════════════

/**
 * เปิดรอบของวันนี้ — copy เช็คลิสต์ 11 ข้อจาก template (0084) เป็น snapshot
 * เปิดซ้ำวันเดียวกัน = คืนรอบเดิม (partial unique ใน 0091 กันไว้อีกชั้น)
 */
export async function openDuty(token: string): Promise<DutyView> {
  const emp = await managerByToken(token);
  if (!emp) throw new ManagerDutyNotFoundError();

  const cutoff = await getDayCutoffHour(emp.user_id);
  const today = businessDate(cutoff);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // มีรอบของวันนี้อยู่แล้ว → คืนรอบเดิม (กันกดซ้ำ)
    const { rows: existing } = await client.query<DutyRow>(
      `SELECT ${DUTY_COLS} FROM manager_duties
       WHERE user_id = $1 AND employee_id = $2 AND business_date = $3::date
         AND status <> 'cancelled'
       FOR UPDATE`,
      [emp.user_id, emp.id, today],
    );
    if (existing[0]) {
      await client.query("COMMIT");
      return mapDuty(existing[0]);
    }

    // เลขรอบ MD-YYYYMMDD-NN ต่อร้าน
    const ymd = today.replace(/-/g, "");
    const { rows: seq } = await client.query<{ n: number }>(
      `SELECT COALESCE(MAX(SUBSTRING(duty_no FROM '[0-9]+$')::int), 0) + 1 AS n
       FROM manager_duties WHERE user_id = $1 AND duty_no LIKE $2`,
      [emp.user_id, `MD-${ymd}-%`],
    );
    const dutyNo = `MD-${ymd}-${String(seq[0].n).padStart(2, "0")}`;

    const { rows: created } = await client.query<DutyRow>(
      `INSERT INTO manager_duties (user_id, employee_id, duty_no, business_date)
       VALUES ($1, $2, $3, $4::date)
       RETURNING ${DUTY_COLS}`,
      [emp.user_id, emp.id, dutyNo, today],
    );

    // copy เช็คลิสต์จาก template ที่เปิดใช้อยู่ — snapshot ชื่อ ณ วันนี้
    // (แก้ template พรุ่งนี้ รอบวันนี้ไม่เปลี่ยน)
    await client.query(
      `INSERT INTO manager_duty_items (duty_id, template_id, title, sort_order)
       SELECT $1, id, title, sort_order
       FROM shift_checklists
       WHERE user_id = $2 AND phase = 'manager' AND is_active
       ORDER BY sort_order`,
      [created[0].id, emp.user_id],
    );

    await client.query("COMMIT");

    // M4: เปิดรอบปุ๊บ เก็บหลักฐานที่มีอยู่แล้วทันที
    // (เช่น ไปตลาดตอนเช้าก่อนเปิดรอบ — ข้อ "ซื้อของ" ต้องติ๊กให้เองเลย)
    await applySystemEvidence(emp.user_id, created[0].id, today);
    return mapDuty(created[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ═══ อัปเดตรายการงาน ════════════════════════════════════════════

export async function setDutyItemStatus(
  token: string,
  input: {
    itemId: string;
    status: "pending" | "done" | "not_required" | "issue";
    /** บังคับเมื่อ not_required */
    reason?: string | null;
    /** บังคับเมื่อ issue — สร้าง store_note ให้จากข้อความนี้ */
    issueTitle?: string | null;
    issueBody?: string | null;
  },
): Promise<DutyItemView> {
  const emp = await managerByToken(token);
  if (!emp) throw new ManagerDutyNotFoundError();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // รายการต้องอยู่ในรอบ "ของผู้จัดการคนนี้" ที่ยังเปิดอยู่เท่านั้น
    const { rows: found } = await client.query<{ id: string; duty_id: string }>(
      `SELECT i.id, i.duty_id
       FROM manager_duty_items i
       JOIN manager_duties d ON d.id = i.duty_id
       WHERE i.id = $1 AND d.user_id = $2 AND d.employee_id = $3 AND d.status = 'open'
       FOR UPDATE OF i`,
      [input.itemId, emp.user_id, emp.id],
    );
    if (!found[0]) {
      // แยกเคสให้ตรง: ไม่มีรายการ vs รอบปิดแล้ว
      const { rows: any } = await client.query(
        `SELECT d.status FROM manager_duty_items i
         JOIN manager_duties d ON d.id = i.duty_id
         WHERE i.id = $1 AND d.user_id = $2 AND d.employee_id = $3`,
        [input.itemId, emp.user_id, emp.id],
      );
      throw any[0] ? new ManagerDutyNotOpenError() : new DutyItemNotFoundError();
    }

    let noteId: string | null = null;
    if (input.status === "not_required" && !input.reason?.trim()) {
      throw new DutyReasonRequiredError();
    }
    if (input.status === "issue") {
      const title = input.issueTitle?.trim();
      if (!title) throw new DutyReasonRequiredError();
      // ปัญหาเข้าสมุดร้านทันที — identity จริงจาก token (CHECK ของ 0086 บังคับ)
      const { rows: note } = await client.query<{ id: string }>(
        `INSERT INTO store_notes
           (user_id, title, body, type, priority, source, reported_by_employee_id)
         VALUES ($1, $2, $3, 'problem', 'important', 'staff_app', $4)
         RETURNING id`,
        [emp.user_id, title.slice(0, 160), input.issueBody?.trim() || null, emp.id],
      );
      noteId = note[0].id;
    }

    const { rows: updated } = await client.query<{
      id: string; title: string; status: DutyItemView["status"];
      not_required_reason: string | null; note_id: string | null;
      evidence: Record<string, unknown> | null; sort_order: number;
    }>(
      // $2 ถูกใช้ทั้ง SET (varchar) และเทียบใน CASE (text) — ต้อง cast ให้ชัด
      // ไม่งั้น Postgres โยน 42P08 "inconsistent types deduced"
      // (บทเรียนเดียวกับ updateNoteStatus ใน store-note-queries)
      `UPDATE manager_duty_items SET
         status = $2::text,
         not_required_reason = CASE WHEN $2::text = 'not_required' THEN $3 ELSE NULL END,
         note_id = CASE WHEN $2::text = 'issue' THEN $4::uuid ELSE note_id END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, title, status, not_required_reason, note_id, evidence, sort_order`,
      [input.itemId, input.status, input.reason?.trim() || null, noteId],
    );

    await client.query("COMMIT");
    const r = updated[0];
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      notRequiredReason: r.not_required_reason,
      noteId: r.note_id,
      evidence: r.evidence,
      sortOrder: r.sort_order,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ═══ ปิดรอบ ═════════════════════════════════════════════════════

/**
 * ปิดรอบ + สร้าง summary snapshot
 *
 * summary คือเอกสารที่ส่งเจ้าของแล้ว — เก็บผลของทุกรายการ ณ ตอนปิด
 * แก้อะไรทีหลังไม่ทำให้รายงานที่ปิดแล้วขยับ (CHECK ใน 0091 บังคับว่าต้องมี)
 *
 * ไม่บังคับว่าต้องเคลียร์ครบทุกข้อ — บางรอบทำไม่ครบได้จริง
 * แต่รายการที่ยัง pending จะติดไปใน summary ให้เจ้าของเห็นตรง ๆ
 */
export async function completeDuty(
  token: string,
  input: { ownerNote?: string | null },
): Promise<DutyView> {
  const emp = await managerByToken(token);
  if (!emp) throw new ManagerDutyNotFoundError();

  const cutoff = await getDayCutoffHour(emp.user_id);
  const today = businessDate(cutoff);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // atomic gate — ใครปิดก่อนได้ไป กดซ้ำเจอ 0 แถว
    const { rows: claimed } = await client.query<DutyRow>(
      `UPDATE manager_duties
       SET status = 'completed', completed_at = now(),
           summary = '{}'::jsonb, updated_at = now()
       WHERE user_id = $1 AND employee_id = $2 AND business_date = $3::date
         AND status = 'open'
       RETURNING ${DUTY_COLS}`,
      [emp.user_id, emp.id, today],
    );
    if (!claimed[0]) {
      // ปิดไปแล้ว → คืนรอบเดิม (กดซ้ำไม่พัง) · ไม่มีรอบ → error
      const { rows: done } = await client.query<DutyRow>(
        `SELECT ${DUTY_COLS} FROM manager_duties
         WHERE user_id = $1 AND employee_id = $2 AND business_date = $3::date
           AND status = 'completed'`,
        [emp.user_id, emp.id, today],
      );
      await client.query("COMMIT");
      if (done[0]) return mapDuty(done[0]);
      throw new ManagerDutyNotFoundError();
    }

    // สร้าง summary จริงจากสถานะรายการ ณ ตอนนี้
    const { rows: items } = await client.query<{
      title: string; status: string; not_required_reason: string | null;
      note_id: string | null; evidence: Record<string, unknown> | null;
    }>(
      `SELECT title, status, not_required_reason, note_id, evidence
       FROM manager_duty_items WHERE duty_id = $1 ORDER BY sort_order`,
      [claimed[0].id],
    );

    const summary = {
      manager: emp.name,
      businessDate: today,
      counts: {
        done: items.filter((i) => i.status === "done").length,
        notRequired: items.filter((i) => i.status === "not_required").length,
        issues: items.filter((i) => i.status === "issue").length,
        pending: items.filter((i) => i.status === "pending").length,
        total: items.length,
      },
      items: items.map((i) => ({
        title: i.title,
        status: i.status,
        reason: i.not_required_reason,
        noteId: i.note_id,
        evidence: i.evidence,
      })),
    };

    await client.query(
      `UPDATE manager_duties SET summary = $2, owner_note = $3, updated_at = now()
       WHERE id = $1`,
      [claimed[0].id, JSON.stringify(summary), input.ownerNote?.trim() || null],
    );
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'staff', $2, 'manager_duty_completed', $3)`,
      [emp.user_id, emp.id, JSON.stringify({ dutyNo: claimed[0].duty_no })],
    );

    await client.query("COMMIT");
    const { rows: fresh } = await pool.query<DutyRow>(
      `SELECT ${DUTY_COLS} FROM manager_duties WHERE id = $1`,
      [claimed[0].id],
    );
    return mapDuty(fresh[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
