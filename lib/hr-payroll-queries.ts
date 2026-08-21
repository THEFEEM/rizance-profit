import { pool } from "@/lib/db";
import { centsToDecimalString, toCents } from "@/lib/money";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * HR Phase 4 (0080) — Payroll: Calculate → Review → Approve → Expense
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) เงินคิดเป็นสตางค์ (integer cents) ตาม convention lib/money.ts —
 *    ไม่มี float · ปัดครึ่งสตางค์ขึ้นต่อบรรทัด deterministic
 * 2) Attendance = source of truth ของเวลา — payroll ไม่คำนวณเวลาใหม่
 *    อ่าน regular/ot minutes ที่ Phase 2/3 บันทึกไว้ตรง ๆ
 * 3) ค่าแรงย้อนตาม employee_wage_history: อัตราของแต่ละวัน = แถวล่าสุด
 *    ที่บันทึกก่อนสิ้นวันนั้น — ค่าแรงเปลี่ยนกลางงวด แต่ละวันใช้อัตราของวันนั้น
 * 4) net_pay server คำนวณเสมอ (client ส่งได้แค่ bonus/deduction lines
 *    พร้อมเหตุผล) · DB CHECK ยันเลขอีกชั้น
 * 5) approve = tx เดียว: recalc → validate → lock → expense → link
 *    idempotent ด้วย atomic gate WHERE expense_entry_id IS NULL
 * 6) posted/approved = immutable — ทุกทางแก้โดน PayrollImmutableError
 */

// ── errors ─────────────────────────────────────────────────────

export class PayrollPeriodExistsError extends Error {}
export class PayrollNotFoundError extends Error {}
export class PayrollImmutableError extends Error {}
export class PayrollStateError extends Error {
  constructor(public from: string, public action: string) {
    super(`invalid_transition:${from}:${action}`);
  }
}
export class PayrollInvariantError extends Error {}

// ── types ──────────────────────────────────────────────────────

export type PayrollStatus = "draft" | "review" | "approved" | "posted" | "cancelled";

export type PayrollDayLine = {
  date: string;
  attendanceId: string;
  regularMinutes: number;
  otMinutes: number;
  lateMinutes: number | null;
  rate: string;          // อัตราที่ใช้จริงของวันนั้น (จาก wage history)
  regularAmount: string;
  otAmount: string;
};

export type PayrollItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  wageType: "hourly" | "daily" | "monthly";
  wageRate: string;
  regularMinutes: number;
  otMinutes: number;
  daysWorked: number;
  regularAmount: string;
  otAmount: string;
  bonusAmount: string;
  deductionAmount: string;
  grossAmount: string;
  netPay: string;
  breakdown: PayrollDayLine[];
  adjustLines: { id: string; kind: "bonus" | "deduction"; amount: string; reason: string }[];
};

export type PayrollPeriod = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollStatus;
  totalAmount: string;
  expenseEntryId: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  code: string; // PAY-YYYY-MM(-DD ถ้าไม่เต็มเดือน)
};

export type PayrollDetail = { period: PayrollPeriod; items: PayrollItem[] };

// ── internal: การคำนวณ (pure ต่อข้อมูลที่ดึงมา) ────────────────

type CalcRow = {
  attendance_id: string;
  employee_id: string;
  employee_name: string;
  business_date: string;
  regular_minutes: number;
  ot_minutes: number;
  late_minutes: number | null;
  wage_type: "hourly" | "daily" | "monthly";
  rate: string; // อัตรา ณ วันนั้น (SQL lateral จาก wage history)
};

type CalcItem = {
  employeeId: string;
  employeeName: string;
  wageType: "hourly" | "daily" | "monthly";
  wageRateSnapshot: string;
  regularMinutes: number;
  otMinutes: number;
  daysWorked: number;
  regularCents: number;
  otCents: number;
  breakdown: PayrollDayLine[];
};

/**
 * ดึงเวลาในงวด + อัตราค่าแรง "ของวันนั้น" ในคำสั่งเดียว:
 * LATERAL หาแถว wage history ล่าสุดที่บันทึกก่อนสิ้นวันของ business_date
 * (fallback = อัตราปัจจุบันบนตัวพนักงาน — เกิดได้เฉพาะข้อมูลก่อนมี history)
 */
async function fetchCalcRows(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<CalcRow[]> {
  const { rows } = await pool.query<CalcRow>(
    `SELECT a.id AS attendance_id, a.employee_id, e.name AS employee_name,
            a.business_date::text AS business_date,
            COALESCE(a.regular_minutes, 0) AS regular_minutes,
            COALESCE(a.ot_minutes, 0) AS ot_minutes,
            a.late_minutes,
            e.wage_type, COALESCE(wh.wage_rate, e.wage_rate)::text AS rate
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN LATERAL (
       SELECT wage_rate FROM employee_wage_history h
       WHERE h.employee_id = a.employee_id
         AND h.recorded_at < (a.business_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
       ORDER BY h.recorded_at DESC LIMIT 1
     ) wh ON true
     WHERE a.user_id = $1
       AND a.business_date BETWEEN $2::date AND $3::date
       AND a.status IN ('completed', 'adjusted')
       AND a.clock_out_at IS NOT NULL
     ORDER BY a.employee_id, a.business_date, a.clock_in_at`,
    [userId, periodStart, periodEnd],
  );
  return rows;
}

/** สตางค์ ปัดครึ่งขึ้น — deterministic */
const roundCents = (v: number) => Math.round(v);

/**
 * รวมรายวัน → รายคน ตาม wage type:
 *   hourly : (นาที ÷ 60) × อัตราวันนั้น · OT × ot_multiplier
 *   daily  : จำนวนวันที่มาทำงาน × อัตราวันนั้น (OT ไม่คิดเงินใน MVP — บันทึกนาทีไว้)
 *   monthly: เงินเดือนคงที่ (อัตราล่าสุดในงวด) — ไม่ prorate ใน MVP
 */
export function calcItems(rows: CalcRow[], otMultiplier: number): CalcItem[] {
  const byEmp = new Map<string, CalcItem & { seenDates: Set<string> }>();
  for (const r of rows) {
    let item = byEmp.get(r.employee_id);
    if (!item) {
      item = {
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        wageType: r.wage_type,
        wageRateSnapshot: r.rate,
        regularMinutes: 0,
        otMinutes: 0,
        daysWorked: 0,
        regularCents: 0,
        otCents: 0,
        breakdown: [],
        seenDates: new Set(),
      };
      byEmp.set(r.employee_id, item);
    }
    const rateCents = toCents(r.rate);
    let regCents = 0;
    let otCents = 0;

    if (r.wage_type === "hourly") {
      regCents = roundCents((r.regular_minutes * rateCents) / 60);
      otCents = roundCents((r.ot_minutes * rateCents * otMultiplier) / 60);
    } else if (r.wage_type === "daily") {
      // วันละครั้ง — กะที่สองของวันเดียวกันไม่ได้ค่าแรงซ้ำ
      if (!item.seenDates.has(r.business_date)) regCents = rateCents;
    }
    // monthly: คิดตอนปิดรายคน (เงินเดือนคงที่)

    if (!item.seenDates.has(r.business_date)) item.daysWorked += 1;
    item.seenDates.add(r.business_date);
    item.regularMinutes += r.regular_minutes;
    item.otMinutes += r.ot_minutes;
    item.regularCents += regCents;
    item.otCents += otCents;
    item.wageRateSnapshot = r.rate; // อัตราล่าสุดในงวด (แถวเรียงตามวันแล้ว)
    item.breakdown.push({
      date: r.business_date,
      attendanceId: r.attendance_id,
      regularMinutes: r.regular_minutes,
      otMinutes: r.ot_minutes,
      lateMinutes: r.late_minutes,
      rate: r.rate,
      regularAmount: centsToDecimalString(regCents),
      otAmount: centsToDecimalString(otCents),
    });
  }

  return [...byEmp.values()].map((it) => {
    if (it.wageType === "monthly") {
      it.regularCents = toCents(it.wageRateSnapshot);
      it.otCents = 0;
    }
    const { seenDates: _seen, ...rest } = it;
    void _seen;
    return rest;
  });
}

async function otMultiplierOf(userId: string): Promise<number> {
  const { rows } = await pool.query<{ ot_multiplier: string }>(
    `SELECT ot_multiplier::text FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  const v = Number(rows[0]?.ot_multiplier ?? 1.5);
  return Number.isFinite(v) && v >= 1 ? v : 1.5;
}

function periodCode(start: string, end: string): string {
  const ym = start.slice(0, 7);
  const fullMonth =
    start.endsWith("-01") && end.slice(0, 7) === ym &&
    Number(end.slice(8)) >= 28; // สิ้นเดือนโดยประมาณ — code เป็นแค่ป้ายอ้างอิง
  return fullMonth ? `PAY-${ym}` : `PAY-${start}_${end}`;
}

// ── preview (ไม่เขียนอะไรเลย) ──────────────────────────────────

export async function previewPayroll(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ items: Omit<PayrollItem, "id" | "adjustLines" | "bonusAmount" | "deductionAmount" | "grossAmount" | "netPay">[] }> {
  const [rows, ot] = await Promise.all([
    fetchCalcRows(userId, periodStart, periodEnd),
    otMultiplierOf(userId),
  ]);
  return {
    items: calcItems(rows, ot).map((it) => ({
      employeeId: it.employeeId,
      employeeName: it.employeeName,
      wageType: it.wageType,
      wageRate: it.wageRateSnapshot,
      regularMinutes: it.regularMinutes,
      otMinutes: it.otMinutes,
      daysWorked: it.daysWorked,
      regularAmount: centsToDecimalString(it.regularCents),
      otAmount: centsToDecimalString(it.otCents),
      breakdown: it.breakdown,
    })),
  };
}

// ── สร้างงวด (draft) + generate items ──────────────────────────

async function writeItems(
  client: { query: typeof pool.query },
  userId: string,
  periodId: string,
  items: CalcItem[],
  keepAdjust: boolean,
): Promise<void> {
  // เก็บ bonus/deduction เดิมไว้ก่อนลบ (regenerate ไม่ทำให้โบนัส manual หาย)
  const prevAdjust = keepAdjust
    ? (
        await client.query<{
          employee_id: string; kind: "bonus" | "deduction"; amount: string; reason: string;
        }>(
          `SELECT pi.employee_id, l.kind, l.amount::text, l.reason
           FROM payroll_adjust_lines l
           JOIN payroll_items pi ON pi.id = l.item_id
           WHERE pi.period_id = $1`,
          [periodId],
        )
      ).rows
    : [];

  await client.query(`DELETE FROM payroll_items WHERE period_id = $1`, [periodId]);

  for (const it of items) {
    const bonusCents = prevAdjust
      .filter((a) => a.employee_id === it.employeeId && a.kind === "bonus")
      .reduce((s, a) => s + toCents(a.amount), 0);
    const dedCents = prevAdjust
      .filter((a) => a.employee_id === it.employeeId && a.kind === "deduction")
      .reduce((s, a) => s + toCents(a.amount), 0);
    const grossCents = it.regularCents + it.otCents;
    const netCents = grossCents + bonusCents - dedCents;

    const { rows: ins } = await client.query<{ id: string }>(
      `INSERT INTO payroll_items
         (period_id, user_id, employee_id, employee_name_snapshot, wage_type,
          wage_rate_snapshot, regular_minutes, ot_minutes, days_worked,
          regular_amount, ot_amount, bonus_amount, deduction_amount,
          gross_amount, net_pay, breakdown)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        periodId, userId, it.employeeId, it.employeeName, it.wageType,
        it.wageRateSnapshot, it.regularMinutes, it.otMinutes, it.daysWorked,
        centsToDecimalString(it.regularCents), centsToDecimalString(it.otCents),
        centsToDecimalString(bonusCents), centsToDecimalString(dedCents),
        // ห้าม clamp — ถ้าหักเกิน gross ให้ DB CHECK (net_pay >= 0) ปฏิเสธตรง ๆ
        centsToDecimalString(grossCents), centsToDecimalString(netCents),
        JSON.stringify(it.breakdown),
      ],
    );
    for (const a of prevAdjust.filter((x) => x.employee_id === it.employeeId)) {
      await client.query(
        `INSERT INTO payroll_adjust_lines (item_id, user_id, kind, amount, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [ins[0].id, userId, a.kind, a.amount, a.reason],
      );
    }
  }

  await client.query(
    `UPDATE payroll_periods p SET
       total_amount = COALESCE(
         (SELECT SUM(net_pay) FROM payroll_items WHERE period_id = p.id), 0),
       updated_at = now()
     WHERE p.id = $1`,
    [periodId],
  );
}

export async function createPayrollPeriod(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollDetail> {
  const [rows, ot] = await Promise.all([
    fetchCalcRows(userId, periodStart, periodEnd),
    otMultiplierOf(userId),
  ]);
  const items = calcItems(rows, ot);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let periodId: string;
    try {
      const { rows: ins } = await client.query<{ id: string }>(
        `INSERT INTO payroll_periods (user_id, period_start, period_end)
         VALUES ($1, $2::date, $3::date) RETURNING id`,
        [userId, periodStart, periodEnd],
      );
      periodId = ins[0].id;
    } catch (err) {
      const e = err as { code?: string; constraint?: string; message?: string };
      if (
        e.code === "23505" &&
        (e.constraint === "idx_payroll_periods_unique" ||
          (e.message ?? "").includes("idx_payroll_periods_unique"))
      ) {
        throw new PayrollPeriodExistsError();
      }
      throw err;
    }
    await writeItems(client, userId, periodId, items, false);
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
       VALUES ($1, 'owner', 'payroll_generated', $2)`,
      [userId, JSON.stringify({ periodId, periodStart, periodEnd, employees: items.length })],
    );
    await client.query("COMMIT");
    return (await getPayrollDetail(userId, periodId))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── อ่าน ───────────────────────────────────────────────────────

type PeriodRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: PayrollStatus;
  total_amount: string;
  expense_entry_id: string | null;
  approved_at: string | null;
  posted_at: string | null;
};

function mapPeriod(r: PeriodRow): PayrollPeriod {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    totalAmount: r.total_amount,
    expenseEntryId: r.expense_entry_id,
    approvedAt: r.approved_at,
    postedAt: r.posted_at,
    code: periodCode(r.period_start, r.period_end),
  };
}

const PERIOD_SELECT = `id, period_start::text AS period_start,
  period_end::text AS period_end, status, total_amount::text AS total_amount,
  expense_entry_id, approved_at::text AS approved_at, posted_at::text AS posted_at`;

export async function listPayrollPeriods(userId: string): Promise<PayrollPeriod[]> {
  const { rows } = await pool.query<PeriodRow>(
    `SELECT ${PERIOD_SELECT} FROM payroll_periods
     WHERE user_id = $1 AND status <> 'cancelled'
     ORDER BY period_start DESC LIMIT 24`,
    [userId],
  );
  return rows.map(mapPeriod);
}

export async function getPayrollDetail(
  userId: string,
  periodId: string,
): Promise<PayrollDetail | null> {
  const { rows: pRows } = await pool.query<PeriodRow>(
    `SELECT ${PERIOD_SELECT} FROM payroll_periods WHERE user_id = $1 AND id = $2`,
    [userId, periodId],
  );
  if (!pRows[0]) return null;

  const { rows: items } = await pool.query<{
    id: string; employee_id: string; employee_name_snapshot: string;
    wage_type: "hourly" | "daily" | "monthly"; wage_rate_snapshot: string;
    regular_minutes: number; ot_minutes: number; days_worked: number;
    regular_amount: string; ot_amount: string; bonus_amount: string;
    deduction_amount: string; gross_amount: string; net_pay: string;
    breakdown: PayrollDayLine[] | null;
  }>(
    `SELECT id, employee_id, employee_name_snapshot, wage_type,
            wage_rate_snapshot::text AS wage_rate_snapshot,
            regular_minutes, ot_minutes, days_worked,
            regular_amount::text AS regular_amount, ot_amount::text AS ot_amount,
            bonus_amount::text AS bonus_amount,
            deduction_amount::text AS deduction_amount,
            gross_amount::text AS gross_amount, net_pay::text AS net_pay, breakdown
     FROM payroll_items WHERE period_id = $1 ORDER BY employee_name_snapshot`,
    [periodId],
  );
  const { rows: lines } = await pool.query<{
    id: string; item_id: string; kind: "bonus" | "deduction"; amount: string; reason: string;
  }>(
    `SELECT l.id, l.item_id, l.kind, l.amount::text AS amount, l.reason
     FROM payroll_adjust_lines l
     JOIN payroll_items pi ON pi.id = l.item_id
     WHERE pi.period_id = $1 ORDER BY l.created_at`,
    [periodId],
  );

  return {
    period: mapPeriod(pRows[0]),
    items: items.map((it) => ({
      id: it.id,
      employeeId: it.employee_id,
      employeeName: it.employee_name_snapshot,
      wageType: it.wage_type,
      wageRate: it.wage_rate_snapshot,
      regularMinutes: it.regular_minutes,
      otMinutes: it.ot_minutes,
      daysWorked: it.days_worked,
      regularAmount: it.regular_amount,
      otAmount: it.ot_amount,
      bonusAmount: it.bonus_amount,
      deductionAmount: it.deduction_amount,
      grossAmount: it.gross_amount,
      netPay: it.net_pay,
      breakdown: it.breakdown ?? [],
      adjustLines: lines
        .filter((l) => l.item_id === it.id)
        .map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, reason: l.reason })),
    })),
  };
}

// ── actions ────────────────────────────────────────────────────

const EDITABLE: PayrollStatus[] = ["draft", "review"];

async function requireEditable(userId: string, periodId: string): Promise<PayrollStatus> {
  const { rows } = await pool.query<{ status: PayrollStatus }>(
    `SELECT status FROM payroll_periods WHERE user_id = $1 AND id = $2`,
    [userId, periodId],
  );
  if (!rows[0]) throw new PayrollNotFoundError();
  if (!EDITABLE.includes(rows[0].status)) throw new PayrollImmutableError();
  return rows[0].status;
}

export async function setPayrollStatus(
  userId: string,
  periodId: string,
  action: "submit_review" | "back_to_draft" | "cancel",
): Promise<void> {
  const from = await requireEditable(userId, periodId);
  const allowed: Record<string, [PayrollStatus, PayrollStatus]> = {
    submit_review: ["draft", "review"],
    back_to_draft: ["review", "draft"],
    cancel: [from === "review" ? "review" : "draft", "cancelled"],
  };
  const [need, next] = allowed[action];
  if (from !== need) throw new PayrollStateError(from, action);
  await pool.query(
    `UPDATE payroll_periods SET status = $3, updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = $4`,
    [userId, periodId, next, need],
  );
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
     VALUES ($1, 'owner', $2, $3)`,
    [userId, `payroll_${action}`, JSON.stringify({ periodId, from, to: next })],
  );
}

/** regenerate จาก attendance ล่าสุด (draft/review เท่านั้น · โบนัส manual คงอยู่) */
export async function regeneratePayroll(userId: string, periodId: string): Promise<void> {
  await requireEditable(userId, periodId);
  const { rows } = await pool.query<{ period_start: string; period_end: string }>(
    `SELECT period_start::text AS period_start, period_end::text AS period_end
     FROM payroll_periods WHERE user_id = $1 AND id = $2`,
    [userId, periodId],
  );
  const [calcRows, ot] = await Promise.all([
    fetchCalcRows(userId, rows[0].period_start, rows[0].period_end),
    otMultiplierOf(userId),
  ]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeItems(client, userId, periodId, calcItems(calcRows, ot), true);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function addAdjustLine(
  userId: string,
  periodId: string,
  input: { itemId: string; kind: "bonus" | "deduction"; amount: number; reason: string },
): Promise<void> {
  await requireEditable(userId, periodId);
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new PayrollInvariantError();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM payroll_items WHERE id = $1 AND period_id = $2 AND user_id = $3`,
      [input.itemId, periodId, userId],
    );
    if (!rows[0]) throw new PayrollNotFoundError();
    await client.query(
      `INSERT INTO payroll_adjust_lines (item_id, user_id, kind, amount, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.itemId, userId, input.kind, centsToDecimalString(amountCents), input.reason.trim()],
    );
    await recomputeItemTotals(client, input.itemId);
    await syncPeriodTotal(client, periodId);
    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
       VALUES ($1, 'owner', $2, $3)`,
      [userId, input.kind === "bonus" ? "bonus_added" : "deduction_added",
       JSON.stringify({ periodId, itemId: input.itemId, amount: input.amount, reason: input.reason })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function removeAdjustLine(
  userId: string,
  periodId: string,
  lineId: string,
): Promise<void> {
  await requireEditable(userId, periodId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ item_id: string }>(
      `DELETE FROM payroll_adjust_lines l
       USING payroll_items pi
       WHERE l.id = $1 AND l.user_id = $2 AND pi.id = l.item_id AND pi.period_id = $3
       RETURNING l.item_id`,
      [lineId, userId, periodId],
    );
    if (!rows[0]) throw new PayrollNotFoundError();
    await recomputeItemTotals(client, rows[0].item_id);
    await syncPeriodTotal(client, periodId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function recomputeItemTotals(
  client: { query: typeof pool.query },
  itemId: string,
): Promise<void> {
  // ต้องจบใน UPDATE เดียว — CHECK (net = gross + bonus - deduction) ยันทุกแถว
  // ตลอดเวลา แยกสอง UPDATE = แถวผิด invariant ชั่วขณะ → DB ปฏิเสธ (ถูกแล้ว)
  await client.query(
    `UPDATE payroll_items pi SET
       bonus_amount = agg.bonus,
       deduction_amount = agg.deduction,
       net_pay = pi.gross_amount + agg.bonus - agg.deduction,
       updated_at = now()
     FROM (
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE kind = 'bonus'), 0) AS bonus,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'deduction'), 0) AS deduction
       FROM payroll_adjust_lines WHERE item_id = $1
     ) agg
     WHERE pi.id = $1`,
    [itemId],
  );
}

async function syncPeriodTotal(
  client: { query: typeof pool.query },
  periodId: string,
): Promise<void> {
  await client.query(
    `UPDATE payroll_periods p SET
       total_amount = COALESCE(
         (SELECT SUM(net_pay) FROM payroll_items WHERE period_id = p.id), 0),
       updated_at = now()
     WHERE p.id = $1`,
    [periodId],
  );
}

// ── approve → expense (หัวใจของ Phase 4) ───────────────────────

/**
 * ทำครบใน transaction เดียว:
 *   1) ล็อกงวด (FOR UPDATE) — ต้องเป็น review
 *   2) recalc จาก attendance สด server-side (ค่า client ไม่มีผล)
 *   3) ยืนยัน invariant: Σ items.net_pay = total
 *   4) approved → INSERT expense (category 'wage') → link ด้วย atomic gate
 *      WHERE expense_entry_id IS NULL → posted
 * retry: งวดที่ posted แล้วคืนของเดิม — ไม่มีทางเกิด expense ใบที่สอง
 */
export async function approvePayroll(
  userId: string,
  periodId: string,
): Promise<PayrollDetail> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: pRows } = await client.query<{
      status: PayrollStatus; period_start: string; period_end: string;
      expense_entry_id: string | null;
    }>(
      `SELECT status, period_start::text AS period_start,
              period_end::text AS period_end, expense_entry_id
       FROM payroll_periods WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, periodId],
    );
    if (!pRows[0]) throw new PayrollNotFoundError();
    const p = pRows[0];

    if (p.status === "posted" && p.expense_entry_id) {
      // retry หลัง timeout — ของถูกโพสต์ไปแล้ว คืนผลเดิม (idempotent)
      await client.query("COMMIT");
      return (await getPayrollDetail(userId, periodId))!;
    }
    if (p.status !== "review") throw new PayrollStateError(p.status, "approve");

    // recalc สดจาก attendance — เวลา/อัตราที่เปลี่ยนหลัง review ถูกสะท้อนเสมอ
    const [calcRows, ot] = await Promise.all([
      fetchCalcRows(userId, p.period_start, p.period_end),
      otMultiplierOf(userId),
    ]);
    await writeItems(client, userId, periodId, calcItems(calcRows, ot), true);

    // invariant ชั้น server (DB CHECK ยันรายแถวอยู่แล้ว)
    const { rows: sums } = await client.query<{ item_sum: string; total: string }>(
      `SELECT COALESCE((SELECT SUM(net_pay) FROM payroll_items
                        WHERE period_id = $1), 0)::text AS item_sum,
              (SELECT total_amount FROM payroll_periods WHERE id = $1)::text AS total`,
      [periodId],
    );
    if (toCents(sums[0].item_sum) !== toCents(sums[0].total)) {
      throw new PayrollInvariantError();
    }
    const totalCents = toCents(sums[0].total);
    if (totalCents <= 0) throw new PayrollInvariantError(); // งวดว่าง — ไม่มีอะไรให้จ่าย

    await client.query(
      `UPDATE payroll_periods SET status = 'approved', approved_at = now(),
         updated_at = now()
       WHERE id = $1 AND status = 'review'`,
      [periodId],
    );

    // expense จริงใน Rizance — category 'wage' (ระบบเดิมรองรับอยู่แล้ว)
    const code = periodCode(p.period_start, p.period_end);
    const { rows: exp } = await client.query<{ id: string }>(
      `INSERT INTO expense_entries
         (user_id, amount, category, payment_method, note, entry_date)
       VALUES ($1, $2, 'wage', 'cash', $3, $4::date)
       RETURNING id`,
      [userId, centsToDecimalString(totalCents),
       `ค่าแรงพนักงาน ${code} (${p.period_start} → ${p.period_end})`.slice(0, 255),
       p.period_end],
    );

    // atomic gate — บรรทัดเดียวที่ตัดสินว่า "โพสต์แล้ว" (กัน expense ซ้ำระดับ DB)
    const { rowCount } = await client.query(
      `UPDATE payroll_periods SET status = 'posted', posted_at = now(),
         expense_entry_id = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND expense_entry_id IS NULL`,
      [periodId, userId, exp[0].id],
    );
    if ((rowCount ?? 0) !== 1) throw new PayrollInvariantError(); // ชนกันเอง → rollback ทั้ง tx (expense หายไปด้วย)

    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
       VALUES ($1, 'owner', 'payroll_approved', $2),
              ($1, 'owner', 'payroll_posted', $3)`,
      [userId,
       JSON.stringify({ periodId, total: sums[0].total }),
       JSON.stringify({ periodId, total: sums[0].total, expenseEntryId: exp[0].id, code })],
    );
    await client.query("COMMIT");
    return (await getPayrollDetail(userId, periodId))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── labor cost (อ่านจากระบบเดิม — ไม่คิดยอดขายใหม่) ────────────

export async function laborCostSummary(userId: string): Promise<{
  monthStart: string;
  laborCost: string;
  sales: string;
  laborPct: string | null;
  targetPct: string;
}> {
  const { rows } = await pool.query<{
    month_start: string; labor: string; sales: string; target: string;
  }>(
    `SELECT date_trunc('month', CURRENT_DATE)::date::text AS month_start,
       COALESCE((SELECT SUM(total_amount) FROM payroll_periods
         WHERE user_id = $1 AND status = 'posted'
           AND period_end >= date_trunc('month', CURRENT_DATE)::date), 0)::text AS labor,
       COALESCE((SELECT SUM(total_amount) FROM pos_bills
         WHERE user_id = $1 AND status = 'paid'
           AND entry_date >= date_trunc('month', CURRENT_DATE)::date), 0)::text AS sales,
       COALESCE((SELECT labor_target_pct FROM hr_settings
         WHERE user_id = $1), 30)::text AS target`,
    [userId],
  );
  const labor = toCents(rows[0].labor);
  const sales = toCents(rows[0].sales);
  return {
    monthStart: rows[0].month_start,
    laborCost: rows[0].labor,
    sales: rows[0].sales,
    laborPct: sales > 0 ? ((labor / sales) * 100).toFixed(1) : null,
    targetPct: rows[0].target,
  };
}

// ── staff: เงินของฉัน (posted เท่านั้น) ────────────────────────

export type StaffPayrollView = {
  items: {
    code: string;
    periodStart: string;
    periodEnd: string;
    regularAmount: string;
    otAmount: string;
    bonusAmount: string;
    deductionAmount: string;
    netPay: string;
  }[];
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export async function staffPayroll(token: string): Promise<StaffPayrollView | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows: emp } = await pool.query<{ id: string }>(
    `SELECT id FROM employees
     WHERE token_hash = $1 AND token_expires_at > now() AND status = 'active'`,
    [hashToken(token)],
  );
  if (!emp[0]) return null;

  // เห็นเฉพาะงวดที่ posted แล้วเท่านั้น — draft/review ยังไม่ finalized ไม่โชว์
  const { rows } = await pool.query<{
    period_start: string; period_end: string;
    regular_amount: string; ot_amount: string; bonus_amount: string;
    deduction_amount: string; net_pay: string;
  }>(
    `SELECT p.period_start::text AS period_start, p.period_end::text AS period_end,
            pi.regular_amount::text AS regular_amount, pi.ot_amount::text AS ot_amount,
            pi.bonus_amount::text AS bonus_amount,
            pi.deduction_amount::text AS deduction_amount, pi.net_pay::text AS net_pay
     FROM payroll_items pi
     JOIN payroll_periods p ON p.id = pi.period_id
     WHERE pi.employee_id = $1 AND p.status = 'posted'
     ORDER BY p.period_start DESC LIMIT 6`,
    [emp[0].id],
  );
  return {
    items: rows.map((r) => ({
      code: periodCode(r.period_start, r.period_end),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      regularAmount: r.regular_amount,
      otAmount: r.ot_amount,
      bonusAmount: r.bonus_amount,
      deductionAmount: r.deduction_amount,
      netPay: r.net_pay,
    })),
  };
}
