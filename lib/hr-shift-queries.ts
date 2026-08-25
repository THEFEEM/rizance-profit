import { pool } from "@/lib/db";

/**
 * HR Phase 3 (0079) — ตารางกะ
 *
 * Template = default กดเร็ว · Shift = ตารางจริงรายวัน (copy ค่า ไม่ผูกแข็ง)
 * กะข้ามเที่ยงคืน: end_min < start_min (convention เดียวกับ campaigns)
 * กะซ้อน: ตรวจใน transaction เดียวกับการเขียน — throw ShiftOverlapError
 */

export class ShiftOverlapError extends Error {
  constructor(public conflict: { startMin: number; endMin: number; date: string }) {
    super("shift_overlap");
  }
}
export class ShiftNotFoundError extends Error {}

export type ShiftStatus = "scheduled" | "working" | "completed" | "absent" | "cancelled";

export type ShiftTemplate = {
  id: string;
  branchId: string | null;
  name: string;
  startMin: number;
  endMin: number;
  breakMinutes: number;
  isActive: boolean;
};

export type Shift = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNickname: string | null;
  branchId: string | null;
  branchName: string | null;
  templateId: string | null;
  businessDate: string;
  startMin: number;
  endMin: number;
  breakMinutes: number;
  status: ShiftStatus;
  note: string | null;
};

// ── helpers ────────────────────────────────────────────────────

/** ช่วงเวลาแบบ normalize — ข้ามเที่ยงคืน end += 1440 เพื่อเทียบซ้อนได้ */
function normalizeRange(startMin: number, endMin: number): [number, number] {
  return endMin <= startMin ? [startMin, endMin + 1440] : [startMin, endMin];
}

/**
 * กะสองกะทับกันไหม — รองรับกะข้ามเที่ยงคืน
 *
 * ═══ บั๊กที่แก้ (26 ส.ค. 2569) ═══════════════════════════════════
 * เดิม normalize แต่ละช่วงแยกกันแล้วเทียบตรง ๆ ซึ่งผิดเมื่อกะหนึ่ง
 * ข้ามเที่ยงคืนแต่อีกกะเริ่มหลังเที่ยงคืน — สองช่วงอยู่คนละ "กรอบวัน"
 *
 *   กะ A 23:57 → 05:04  normalize → [1437, 1744]
 *   กะ B 01:04 → 06:44  normalize → [  64,  404]
 *   1437 < 404 → false  ← ตรวจไม่เจอ ทั้งที่ทับกันจริงช่วง 01:04–05:04
 *
 * ผลจริง: จัดกะซ้อนให้คนเดียวกันได้ถ้ากะแรกข้ามเที่ยงคืน
 * (ร้านที่ปิดดึกมีโอกาสเจอ)
 *
 * ═══ วิธีแก้ ═══════════════════════════════════════════════════
 * เวลาในหนึ่งวันเป็น "วงกลม" ไม่ใช่เส้นตรง — กะเดียวกันจึงเขียนได้
 * หลายกรอบ ([64,404] กับ [1504,1844] คือช่วงเดียวกัน คนละรอบวัน)
 * จึงต้องเทียบ B กับ A ทั้ง 3 กรอบ: ตัวมันเอง เลื่อนหน้า และเลื่อนหลัง
 *
 * กะยาวไม่เกิน 24 ชม. → 3 กรอบครอบคลุมทุกกรณี
 *
 * นโยบายเดิมคงไว้: ชนขอบพอดี (จบ 06:00 / เริ่ม 06:00) = ไม่นับว่าทับ
 */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  const [s1, e1] = normalizeRange(aStart, aEnd);
  const [s2, e2] = normalizeRange(bStart, bEnd);
  const DAY = 1440;
  for (const shift of [0, DAY, -DAY]) {
    if (s1 < e2 + shift && s2 + shift < e1) return true;
  }
  return false;
}

/** นาทีทำงานตามกะ (หัก break) */
export function shiftMinutes(s: { startMin: number; endMin: number; breakMinutes: number }): number {
  const [start, end] = normalizeRange(s.startMin, s.endMin);
  return Math.max(0, end - start - s.breakMinutes);
}

type ShiftRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  branch_id: string | null;
  branch_name: string | null;
  template_id: string | null;
  business_date: string;
  start_min: number;
  end_min: number;
  break_minutes: number;
  status: ShiftStatus;
  note: string | null;
};

const SHIFT_SELECT = `
  s.id, s.employee_id, e.name AS employee_name, e.nickname AS employee_nickname,
  s.branch_id, b.name AS branch_name, s.template_id,
  s.business_date::text AS business_date, s.start_min, s.end_min,
  s.break_minutes, s.status, s.note
  FROM shifts s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN branches b ON b.id = s.branch_id`;

function mapShift(r: ShiftRow): Shift {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeNickname: r.employee_nickname,
    branchId: r.branch_id,
    branchName: r.branch_name,
    templateId: r.template_id,
    businessDate: r.business_date,
    startMin: r.start_min,
    endMin: r.end_min,
    breakMinutes: r.break_minutes,
    status: r.status,
    note: r.note,
  };
}

/** ตรวจกะซ้อนของพนักงานคนเดียวกันในวันเดียวกัน (ไม่นับ cancelled/absent) */
async function assertNoOverlap(
  client: { query: typeof pool.query },
  userId: string,
  employeeId: string,
  date: string,
  startMin: number,
  endMin: number,
  excludeShiftId?: string,
): Promise<void> {
  const { rows } = await client.query<{ start_min: number; end_min: number }>(
    `SELECT start_min, end_min FROM shifts
     WHERE user_id = $1 AND employee_id = $2 AND business_date = $3::date
       AND status NOT IN ('cancelled', 'absent')
       ${excludeShiftId ? "AND id <> $4" : ""}`,
    excludeShiftId
      ? [userId, employeeId, date, excludeShiftId]
      : [userId, employeeId, date],
  );
  for (const r of rows) {
    if (rangesOverlap(startMin, endMin, r.start_min, r.end_min)) {
      throw new ShiftOverlapError({
        startMin: r.start_min,
        endMin: r.end_min,
        date,
      });
    }
  }
}

// ── templates ──────────────────────────────────────────────────

export async function listShiftTemplates(userId: string): Promise<ShiftTemplate[]> {
  const { rows } = await pool.query<{
    id: string; branch_id: string | null; name: string; start_min: number;
    end_min: number; break_minutes: number; is_active: boolean;
  }>(
    `SELECT id, branch_id, name, start_min, end_min, break_minutes, is_active
     FROM shift_templates WHERE user_id = $1 ORDER BY start_min, name`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    name: r.name,
    startMin: r.start_min,
    endMin: r.end_min,
    breakMinutes: r.break_minutes,
    isActive: r.is_active,
  }));
}

export async function createShiftTemplate(
  userId: string,
  input: { name: string; startMin: number; endMin: number; breakMinutes?: number; branchId?: string | null },
): Promise<ShiftTemplate> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shift_templates (user_id, branch_id, name, start_min, end_min, break_minutes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, input.branchId ?? null, input.name.trim(), input.startMin, input.endMin, input.breakMinutes ?? 0],
  );
  return {
    id: rows[0].id,
    branchId: input.branchId ?? null,
    name: input.name.trim(),
    startMin: input.startMin,
    endMin: input.endMin,
    breakMinutes: input.breakMinutes ?? 0,
    isActive: true,
  };
}

export async function updateShiftTemplate(
  userId: string,
  id: string,
  input: Partial<{ name: string; startMin: number; endMin: number; breakMinutes: number; isActive: boolean }>,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE shift_templates SET
       name = COALESCE($3, name),
       start_min = COALESCE($4, start_min),
       end_min = COALESCE($5, end_min),
       break_minutes = COALESCE($6, break_minutes),
       is_active = COALESCE($7, is_active),
       updated_at = now()
     WHERE user_id = $1 AND id = $2`,
    [userId, id, input.name?.trim() ?? null, input.startMin ?? null,
     input.endMin ?? null, input.breakMinutes ?? null, input.isActive ?? null],
  );
  return (rowCount ?? 0) > 0;
}

// ── shifts ─────────────────────────────────────────────────────

export type ShiftInput = {
  employeeId: string;
  businessDate: string;
  startMin: number;
  endMin: number;
  breakMinutes?: number;
  branchId?: string | null;
  templateId?: string | null;
  note?: string | null;
};

export async function createShift(userId: string, input: ShiftInput): Promise<Shift> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // พนักงานต้องเป็นของร้านนี้
    const { rows: emp } = await client.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM employees WHERE id = $1 AND user_id = $2`,
      [input.employeeId, userId],
    );
    if (!emp[0]) throw new ShiftNotFoundError();

    await assertNoOverlap(
      client, userId, input.employeeId, input.businessDate,
      input.startMin, input.endMin,
    );

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO shifts
         (user_id, employee_id, branch_id, template_id, business_date,
          start_min, end_min, break_minutes, note)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
       RETURNING id`,
      [userId, input.employeeId,
       input.branchId ?? emp[0].branch_id, input.templateId ?? null,
       input.businessDate, input.startMin, input.endMin,
       input.breakMinutes ?? 0, input.note?.trim() || null],
    );
    await client.query("COMMIT");
    return (await getShift(userId, rows[0].id))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getShift(userId: string, id: string): Promise<Shift | null> {
  const { rows } = await pool.query<ShiftRow>(
    `SELECT ${SHIFT_SELECT} WHERE s.user_id = $1 AND s.id = $2`,
    [userId, id],
  );
  return rows[0] ? mapShift(rows[0]) : null;
}

export async function listShifts(
  userId: string,
  range: { from: string; to: string; employeeId?: string; branchId?: string },
): Promise<Shift[]> {
  const conds = ["s.user_id = $1", "s.business_date BETWEEN $2::date AND $3::date"];
  const params: string[] = [userId, range.from, range.to];
  let i = 4;
  if (range.employeeId) {
    conds.push(`s.employee_id = $${i}`);
    params.push(range.employeeId);
    i += 1;
  }
  if (range.branchId) {
    conds.push(`s.branch_id = $${i}`);
    params.push(range.branchId);
    i += 1;
  }
  const { rows } = await pool.query<ShiftRow>(
    `SELECT ${SHIFT_SELECT} WHERE ${conds.join(" AND ")}
     ORDER BY s.business_date, s.start_min, e.name`,
    params,
  );
  return rows.map(mapShift);
}

export type ShiftPatch = Partial<{
  employeeId: string;
  startMin: number;
  endMin: number;
  breakMinutes: number;
  businessDate: string;
  note: string | null;
  status: ShiftStatus; // cancel / absent / กลับเป็น scheduled — owner ตัดสิน
}>;

export async function updateShift(
  userId: string,
  id: string,
  input: ShiftPatch,
): Promise<Shift> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{
      employee_id: string; business_date: string; start_min: number;
      end_min: number; status: ShiftStatus;
    }>(
      `SELECT employee_id, business_date::text AS business_date, start_min, end_min, status
       FROM shifts WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, id],
    );
    if (!cur[0]) throw new ShiftNotFoundError();

    const next = {
      employeeId: input.employeeId ?? cur[0].employee_id,
      businessDate: input.businessDate ?? cur[0].business_date,
      startMin: input.startMin ?? cur[0].start_min,
      endMin: input.endMin ?? cur[0].end_min,
      status: input.status ?? cur[0].status,
    };

    if (input.employeeId) {
      const { rows: emp } = await client.query(
        `SELECT 1 FROM employees WHERE id = $1 AND user_id = $2`,
        [input.employeeId, userId],
      );
      if (!emp[0]) throw new ShiftNotFoundError();
    }

    // ตรวจซ้อนเมื่อเวลา/คน/วันเปลี่ยน และกะยังนับอยู่
    if (next.status !== "cancelled" && next.status !== "absent") {
      await assertNoOverlap(
        client, userId, next.employeeId, next.businessDate,
        next.startMin, next.endMin, id,
      );
    }

    await client.query(
      `UPDATE shifts SET
         employee_id = $3, business_date = $4::date,
         start_min = $5, end_min = $6,
         break_minutes = COALESCE($7, break_minutes),
         status = $8,
         note = COALESCE($9, note),
         updated_at = now()
       WHERE id = $2 AND user_id = $1`,
      [userId, id, next.employeeId, next.businessDate, next.startMin,
       next.endMin, input.breakMinutes ?? null, next.status,
       input.note === undefined ? null : input.note],
    );
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'owner', $2, 'shift_updated', $3)`,
      [userId, next.employeeId, JSON.stringify({ shiftId: id, status: next.status })],
    );
    await client.query("COMMIT");
    return (await getShift(userId, id))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * คัดลอกตารางกะ — day: from→to (1 วัน) · week: fromStart→toStart (7 วัน)
 * ข้ามกะที่จะซ้อนกับของที่มีอยู่แล้ว (นับเป็น skipped ไม่ใช่ error —
 * ใช้ตอน "วางทับสัปดาห์ที่มีของอยู่บางวัน")
 */
export async function copyShifts(
  userId: string,
  input: { from: string; to: string; days: number },
): Promise<{ copied: number; skipped: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let copied = 0;
    let skipped = 0;
    for (let d = 0; d < input.days; d += 1) {
      const { rows: src } = await client.query<{
        employee_id: string; branch_id: string | null; template_id: string | null;
        start_min: number; end_min: number; break_minutes: number;
        src_date: string; dst_date: string;
      }>(
        `SELECT s.employee_id, s.branch_id, s.template_id, s.start_min, s.end_min,
                s.break_minutes,
                ($2::date + $4::int)::text AS src_date,
                ($3::date + $4::int)::text AS dst_date
         FROM shifts s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.user_id = $1 AND s.business_date = $2::date + $4::int
           AND s.status NOT IN ('cancelled')
           AND e.status = 'active'`,
        [userId, input.from, input.to, d],
      );
      for (const r of src) {
        try {
          await assertNoOverlap(
            client, userId, r.employee_id, r.dst_date, r.start_min, r.end_min,
          );
        } catch (err) {
          if (err instanceof ShiftOverlapError) {
            skipped += 1;
            continue;
          }
          throw err;
        }
        await client.query(
          `INSERT INTO shifts
             (user_id, employee_id, branch_id, template_id, business_date,
              start_min, end_min, break_minutes)
           VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
          [userId, r.employee_id, r.branch_id, r.template_id, r.dst_date,
           r.start_min, r.end_min, r.break_minutes],
        );
        copied += 1;
      }
    }
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
       VALUES ($1, 'owner', 'shifts_copied', $2)`,
      [userId, JSON.stringify({ ...input, copied, skipped })],
    );
    await client.query("COMMIT");
    return { copied, skipped };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
