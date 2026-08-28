import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { hashToken } from "@/lib/hr-employee-queries";
import { centsToDecimalString, toCents } from "@/lib/money";
import { NotManagerError } from "@/lib/manager-duty-queries";

/**
 * สมุดเงินสดรายวัน (0091)
 *
 * ═══ สมการ ═══════════════════════════════════════════════════
 *   ควรมี  = ยกมา + ขายเงินสด − รายจ่ายเงินสด + เงินเข้า − ถอนออก
 *   ผลต่าง = นับจริง − ควรมี
 *
 * ═══ แหล่งตัวเลข — server ล้วน client กรอกได้แค่ "นับจริง" ═══════
 *   ขายเงินสด   ← pos_bills (paid + cash + entry_date)   ห้ามกรอก
 *   รายจ่ายเงินสด ← expense_entries (payment_method='cash') แหล่งเดียว
 *                  ใบซื้อ 0085 เขียนลงตารางนี้อยู่แล้ว → เห็นอัตโนมัติ
 *                  ไม่มีทาง double count เพราะไม่มีตารางรายจ่ายที่สอง
 *   เงินเข้า/ถอน ← cash_movements (เฉพาะ cash_in/withdrawal)
 *   ยกมา        ← เช็คที่ปิดแล้วของวันก่อน (carried) หรือกรอกครั้งแรก (manual)
 *
 * ═══ ปิดเช็คแล้ว = snapshot ถาวร ═══════════════════════════════
 *   void บิล/แก้ expense ย้อนหลังทำให้ตัวเลขสดขยับได้
 *   แต่รายงานที่ส่งเจ้าของไปแล้วห้ามขยับตาม — CHECK ใน 0091 บังคับสมการซ้ำ
 */

export class CashCheckNotFoundError extends Error {
  constructor() {
    super("cash_check_not_found");
    this.name = "CashCheckNotFoundError";
  }
}
export class CashCheckCompletedError extends Error {
  constructor() {
    super("cash_check_completed");
    this.name = "CashCheckCompletedError";
  }
}
export class CashReasonRequiredError extends Error {
  constructor() {
    super("cash_reason_required");
    this.name = "CashReasonRequiredError";
  }
}
export class OpeningCashRequiredError extends Error {
  constructor() {
    super("opening_cash_required");
    this.name = "OpeningCashRequiredError";
  }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

type ManagerEmp = { id: string; user_id: string; name: string };

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

// ═══ views ═════════════════════════════════════════════════════

export type CashExpenseLine = {
  id: string;
  note: string | null;
  category: string;
  amount: string;
  createdAt: string;
};

export type CashMovementLine = {
  id: string;
  movementType: "cash_in" | "withdrawal" | "adjustment";
  amount: string;
  reason: string;
  createdByName: string | null;
  createdAt: string;
};

export type DailyCashView = {
  businessDate: string;
  status: "not_started" | "open" | "completed";
  checkId: string | null;

  /** null = วันแรก/ไม่มีเช็คปิดของวันก่อน → ต้องกรอกเองครั้งเดียว */
  openingCash: string | null;
  openingSource: "carried" | "manual" | null;
  /** ค่าที่ระบบเสนอให้ตอนยังไม่เริ่ม (จากเช็คปิดของวันก่อน) */
  suggestedOpening: string | null;

  cashSales: string;
  cashExpenses: string;
  cashIn: string;
  withdrawals: string;
  expectedCash: string | null;

  /** snapshot หลังปิด (ตัวเลขนิ่ง) */
  actualCash: string | null;
  difference: string | null;
  differenceReason: string | null;
  countedByName: string | null;
  completedAt: string | null;

  expenseLines: CashExpenseLine[];
  movementLines: CashMovementLine[];
};

/** ยอดสด ณ ตอนนี้ของวันหนึ่ง — ใช้ทั้งตอนแสดงและตอนปิด (ไม่มี calculator ที่สอง) */
async function liveTotals(userId: string, date: string) {
  const [sales, expenses, moves] = await Promise.all([
    // ยอดขาย "เงินสด" — pattern เดียวกับ pos-summary (0051):
    //   บิลจ่ายผสม (split) เก็บส่วนเงินสดใน pos_bill_payments
    //   บิลปกติใช้ payment_method บนหัวบิล
    // นับแค่หัวบิล = พลาดเงินสดในบิล split → ลิ้นชักไม่ตรงแบบหาสาเหตุไม่เจอ
    pool.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM (
         SELECT p.amount
         FROM pos_bill_payments p
         JOIN pos_bills b ON b.id = p.bill_id
         WHERE b.user_id = $1 AND b.entry_date = $2::date
           AND b.status = 'paid' AND p.method = 'cash'
         UNION ALL
         SELECT b.total_amount AS amount
         FROM pos_bills b
         WHERE b.user_id = $1 AND b.entry_date = $2::date
           AND b.status = 'paid' AND b.payment_method = 'cash'
           AND NOT EXISTS (SELECT 1 FROM pos_bill_payments p WHERE p.bill_id = b.id)
       ) x`,
      [userId, date],
    ),
    pool.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v
       FROM expense_entries
       WHERE user_id = $1 AND entry_date = $2::date AND payment_method = 'cash'`,
      [userId, date],
    ),
    pool.query<{ t: string; v: string }>(
      `SELECT movement_type AS t, COALESCE(SUM(amount), 0)::text AS v
       FROM cash_movements
       WHERE user_id = $1 AND business_date = $2::date
       GROUP BY movement_type`,
      [userId, date],
    ),
  ]);
  const byType = new Map(moves.rows.map((r) => [r.t, r.v]));
  return {
    cashSales: sales.rows[0].v,
    cashExpenses: expenses.rows[0].v,
    cashIn: byType.get("cash_in") ?? "0",
    withdrawals: byType.get("withdrawal") ?? "0",
  };
}

/** เงินยกมาที่ระบบเสนอ = actual ของเช็คปิดล่าสุดก่อนวันนี้ − ถอนหลังปิด (ถ้ามี) */
async function suggestedOpening(userId: string, date: string): Promise<string | null> {
  const { rows } = await pool.query<{ actual_cash: string; business_date: string }>(
    `SELECT actual_cash::text AS actual_cash, business_date::text AS business_date
     FROM daily_cash_checks
     WHERE user_id = $1 AND business_date < $2::date AND status = 'completed'
     ORDER BY business_date DESC LIMIT 1`,
    [userId, date],
  );
  if (!rows[0]) return null;
  // ถอนเงิน "หลังนับ" ของวันนั้น (เช่น เอาไปฝากธนาคารตอนกลับบ้าน)
  // ถูกบันทึกเป็น movement ของวันเดิม — แต่ตอนนับมันยังอยู่ในลิ้นชัก
  // จึงหักออกจากยอดยกมา ไม่ใช่ไปแก้เช็คที่ปิดแล้ว
  const { rows: lateWd } = await pool.query<{ v: string }>(
    `SELECT COALESCE(SUM(m.amount), 0)::text AS v
     FROM cash_movements m
     JOIN daily_cash_checks c
       ON c.user_id = m.user_id AND c.business_date = m.business_date
     WHERE m.user_id = $1 AND m.business_date = $2::date
       AND m.movement_type = 'withdrawal'
       AND c.completed_at IS NOT NULL AND m.created_at > c.completed_at`,
    [userId, rows[0].business_date],
  );
  const cents = toCents(rows[0].actual_cash) - toCents(lateWd[0].v);
  return centsToDecimalString(Math.max(cents, 0));
}

async function expenseLines(userId: string, date: string): Promise<CashExpenseLine[]> {
  const { rows } = await pool.query<{
    id: string; note: string | null; category: string; amount: string; created_at: string;
  }>(
    `SELECT id, note, category, amount::text AS amount, created_at::text AS created_at
     FROM expense_entries
     WHERE user_id = $1 AND entry_date = $2::date AND payment_method = 'cash'
     ORDER BY created_at`,
    [userId, date],
  );
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    category: r.category,
    amount: r.amount,
    createdAt: r.created_at,
  }));
}

async function movementLines(userId: string, date: string): Promise<CashMovementLine[]> {
  const { rows } = await pool.query<{
    id: string; movement_type: CashMovementLine["movementType"]; amount: string;
    reason: string; created_by_name: string | null; created_at: string;
  }>(
    `SELECT id, movement_type, amount::text AS amount, reason,
            created_by_name, created_at::text AS created_at
     FROM cash_movements
     WHERE user_id = $1 AND business_date = $2::date
     ORDER BY created_at`,
    [userId, date],
  );
  return rows.map((r) => ({
    id: r.id,
    movementType: r.movement_type,
    amount: r.amount,
    reason: r.reason,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  }));
}

/** จอเงินสดของวันนี้ — completed แล้วอ่านจาก snapshot ไม่คำนวณใหม่ */
export async function dailyCashView(token: string): Promise<DailyCashView | null> {
  const emp = await managerByToken(token);
  if (!emp) return null;

  const cutoff = await getDayCutoffHour(emp.user_id);
  const date = businessDate(cutoff);

  const { rows: checks } = await pool.query<{
    id: string; status: "open" | "completed";
    opening_cash: string; opening_source: "carried" | "manual";
    cash_sales: string | null; cash_expenses: string | null;
    cash_in: string | null; withdrawals: string | null;
    expected_cash: string | null; actual_cash: string | null;
    difference: string | null; difference_reason: string | null;
    counted_by_name: string | null; completed_at: string | null;
  }>(
    `SELECT id, status, opening_cash::text AS opening_cash, opening_source,
            cash_sales::text AS cash_sales, cash_expenses::text AS cash_expenses,
            cash_in::text AS cash_in, withdrawals::text AS withdrawals,
            expected_cash::text AS expected_cash, actual_cash::text AS actual_cash,
            difference::text AS difference, difference_reason,
            counted_by_name, completed_at::text AS completed_at
     FROM daily_cash_checks WHERE user_id = $1 AND business_date = $2::date`,
    [emp.user_id, date],
  );
  const check = checks[0] ?? null;

  const [lines, moves] = await Promise.all([
    expenseLines(emp.user_id, date),
    movementLines(emp.user_id, date),
  ]);

  // ── ปิดแล้ว: ทุกตัวเลขจาก snapshot — void ย้อนหลังไม่ทำให้รายงานขยับ ──
  if (check && check.status === "completed") {
    return {
      businessDate: date,
      status: "completed",
      checkId: check.id,
      openingCash: check.opening_cash,
      openingSource: check.opening_source,
      suggestedOpening: null,
      cashSales: check.cash_sales ?? "0",
      cashExpenses: check.cash_expenses ?? "0",
      cashIn: check.cash_in ?? "0",
      withdrawals: check.withdrawals ?? "0",
      expectedCash: check.expected_cash,
      actualCash: check.actual_cash,
      difference: check.difference,
      differenceReason: check.difference_reason,
      countedByName: check.counted_by_name,
      completedAt: check.completed_at,
      expenseLines: lines,
      movementLines: moves,
    };
  }

  // ── ยังไม่ปิด: คำนวณสด ──
  const live = await liveTotals(emp.user_id, date);
  const opening = check?.opening_cash ?? null;
  const expected =
    opening == null
      ? null
      : centsToDecimalString(
          toCents(opening) +
            toCents(live.cashSales) -
            toCents(live.cashExpenses) +
            toCents(live.cashIn) -
            toCents(live.withdrawals),
        );

  return {
    businessDate: date,
    status: check ? "open" : "not_started",
    checkId: check?.id ?? null,
    openingCash: opening,
    openingSource: check?.opening_source ?? null,
    suggestedOpening: check ? null : await suggestedOpening(emp.user_id, date),
    cashSales: live.cashSales,
    cashExpenses: live.cashExpenses,
    cashIn: live.cashIn,
    withdrawals: live.withdrawals,
    expectedCash: expected,
    actualCash: null,
    difference: null,
    differenceReason: null,
    countedByName: null,
    completedAt: null,
    expenseLines: lines,
    movementLines: moves,
  };
}

// ═══ เริ่มเช็คของวัน (ตั้งเงินยกมา) ══════════════════════════════

/**
 * เริ่มเช็ค — ครั้งแรกของร้านต้องกรอกยอดนับจริง (manual)
 * วันถัด ๆ ไประบบเสนอยอดยกจากเช็คปิดของวันก่อน (carried) แก้ได้ถ้าไม่ตรง
 * เริ่มซ้ำ = คืนของเดิม
 */
export async function startCashCheck(
  token: string,
  input: { openingCash?: number | null },
): Promise<DailyCashView> {
  const emp = await managerByToken(token);
  if (!emp) throw new CashCheckNotFoundError();

  const cutoff = await getDayCutoffHour(emp.user_id);
  const date = businessDate(cutoff);

  const carried = await suggestedOpening(emp.user_id, date);
  const manual = input.openingCash;

  let opening: string;
  let source: "carried" | "manual";
  if (manual != null && Number.isFinite(manual) && manual >= 0) {
    opening = manual.toFixed(2);
    // กรอกมาเท่ากับที่ระบบเสนอเป๊ะ = ยกยอด · ต่างไป = ตั้งเอง (มีร่องรอย)
    source = carried != null && toCents(opening) === toCents(carried) ? "carried" : "manual";
  } else if (carried != null) {
    opening = carried;
    source = "carried";
  } else {
    throw new OpeningCashRequiredError(); // วันแรก — ต้องนับจริงหนึ่งครั้ง
  }

  await pool.query(
    `INSERT INTO daily_cash_checks (user_id, business_date, opening_cash, opening_source)
     VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (user_id, business_date) DO NOTHING`,
    [emp.user_id, date, opening, source],
  );

  const view = await dailyCashView(token);
  if (!view) throw new CashCheckNotFoundError();
  return view;
}

// ═══ รายจ่ายเงินสด / เงินเข้า-ถอนออก ═════════════════════════════

/**
 * เพิ่มรายจ่ายเงินสด = insert expense_entries ธรรมดา (ตารางเดิม แหล่งเดียว)
 * ⚠️ ของที่ซื้อผ่านหน้ารับของ/ใบซื้อ ไม่ต้องกรอกซ้ำ — โผล่ในลิสต์อยู่แล้ว
 */
export async function addCashExpense(
  token: string,
  input: { label: string; amount: number; category?: string },
): Promise<DailyCashView> {
  const emp = await managerByToken(token);
  if (!emp) throw new CashCheckNotFoundError();
  await assertNotCompleted(emp.user_id);

  const cutoff = await getDayCutoffHour(emp.user_id);
  const date = businessDate(cutoff);
  // หมวดต้องอยู่ใน CHECK ของ expense_entries (0009) — "อื่น ๆ" คือ expense_misc
  const cat = ["materials", "equipment", "utilities"].includes(input.category ?? "")
    ? (input.category as string)
    : "expense_misc";

  await pool.query(
    `INSERT INTO expense_entries (user_id, amount, category, payment_method, note, entry_date)
     VALUES ($1, $2, $3, 'cash', $4, $5::date)`,
    [emp.user_id, input.amount.toFixed(2), cat, input.label.trim().slice(0, 255), date],
  );
  const view = await dailyCashView(token);
  if (!view) throw new CashCheckNotFoundError();
  return view;
}

/** เงินเข้า (เติมทอน — ไม่ใช่รายได้) / ถอนออก (ฝากธนาคาร — ไม่ใช่รายจ่าย) */
export async function addCashMovement(
  token: string,
  input: { movementType: "cash_in" | "withdrawal"; amount: number; reason: string },
): Promise<DailyCashView> {
  const emp = await managerByToken(token);
  if (!emp) throw new CashCheckNotFoundError();
  await assertNotCompleted(emp.user_id);
  if (!input.reason.trim()) throw new CashReasonRequiredError();

  const cutoff = await getDayCutoffHour(emp.user_id);
  const date = businessDate(cutoff);

  await pool.query(
    `INSERT INTO cash_movements
       (user_id, business_date, movement_type, amount, reason,
        created_by_employee_id, created_by_name)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7)`,
    [
      emp.user_id,
      date,
      input.movementType,
      input.amount.toFixed(2),
      input.reason.trim().slice(0, 255),
      emp.id,
      emp.name,
    ],
  );
  const view = await dailyCashView(token);
  if (!view) throw new CashCheckNotFoundError();
  return view;
}

/** เช็คของวันนี้ปิดแล้วห้ามเพิ่มรายการเงินสดผ่านหน้านี้ (snapshot ต้องนิ่ง) */
async function assertNotCompleted(userId: string): Promise<void> {
  const cutoff = await getDayCutoffHour(userId);
  const date = businessDate(cutoff);
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM daily_cash_checks WHERE user_id = $1 AND business_date = $2::date`,
    [userId, date],
  );
  if (rows[0]?.status === "completed") throw new CashCheckCompletedError();
}

// ═══ ปิดเช็ค — จุดเดียวที่ client ส่งตัวเลข (นับจริง) ═══════════════

export async function completeCashCheck(
  token: string,
  input: { actualCash: number; differenceReason?: string | null },
): Promise<DailyCashView> {
  const emp = await managerByToken(token);
  if (!emp) throw new CashCheckNotFoundError();

  const cutoff = await getDayCutoffHour(emp.user_id);
  const date = businessDate(cutoff);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ล็อกเช็ค — ต้องเริ่มไว้แล้วและยังไม่ปิด
    const { rows: checks } = await client.query<{
      id: string; status: string; opening_cash: string;
    }>(
      `SELECT id, status, opening_cash::text AS opening_cash
       FROM daily_cash_checks
       WHERE user_id = $1 AND business_date = $2::date
       FOR UPDATE`,
      [emp.user_id, date],
    );
    if (!checks[0]) throw new CashCheckNotFoundError();
    if (checks[0].status === "completed") throw new CashCheckCompletedError();

    // ★ ตัวเลขทุกตัวคำนวณสดฝั่ง server ณ วินาทีปิด — ไม่รับจาก client
    const live = await liveTotals(emp.user_id, date);
    const expectedCents =
      toCents(checks[0].opening_cash) +
      toCents(live.cashSales) -
      toCents(live.cashExpenses) +
      toCents(live.cashIn) -
      toCents(live.withdrawals);
    const actualCents = Math.round(input.actualCash * 100);
    const diffCents = actualCents - expectedCents;

    // เงินไม่ตรง → ต้องบอกเหตุผล (DB CHECK บังคับซ้ำอีกชั้น)
    const reason = input.differenceReason?.trim() || null;
    if (diffCents !== 0 && !reason) throw new CashReasonRequiredError();

    await client.query(
      `UPDATE daily_cash_checks SET
         status = 'completed',
         cash_sales = $2, cash_expenses = $3, cash_in = $4, withdrawals = $5,
         expected_cash = $6, actual_cash = $7, difference = $8,
         difference_reason = $9,
         counted_by_employee_id = $10, counted_by_name = $11,
         completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        checks[0].id,
        live.cashSales,
        live.cashExpenses,
        live.cashIn,
        live.withdrawals,
        centsToDecimalString(expectedCents),
        centsToDecimalString(actualCents),
        centsToDecimalString(diffCents),
        diffCents === 0 ? null : reason,
        emp.id,
        emp.name,
      ],
    );

    // Mission เงินสดในรอบงานวันนี้ → done อัตโนมัติ (System Evidence)
    await client.query(
      `UPDATE manager_duty_items i SET
         status = 'done',
         evidence = jsonb_build_object(
           'kind', 'cash_check', 'checkId', $3::text,
           'difference', $4::text),
         updated_at = now()
       FROM manager_duties d
       WHERE i.duty_id = d.id AND d.user_id = $1 AND d.business_date = $2::date
         AND d.status = 'open'
         AND i.title LIKE '%เงินสด%' AND i.status = 'pending'`,
      [emp.user_id, date, checks[0].id, centsToDecimalString(diffCents)],
    );

    await client.query(
      `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
       VALUES ($1, 'staff', $2, 'cash_check_completed', $3)`,
      [
        emp.user_id,
        emp.id,
        JSON.stringify({
          businessDate: date,
          expected: centsToDecimalString(expectedCents),
          actual: centsToDecimalString(actualCents),
          difference: centsToDecimalString(diffCents),
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const view = await dailyCashView(token);
  if (!view) throw new CashCheckNotFoundError();
  return view;
}

// ═══ รายงานสำหรับส่ง LINE (คัดลอก) ══════════════════════════════

const B = (v: string | null) =>
  `฿${Number(v ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;

/**
 * ข้อความรายงาน — สร้างจาก DailyCashView ก้อนเดียวกับที่ UI แสดง
 * ห้ามคำนวณอะไรใหม่ในนี้ (ไม่มี calculator ที่สอง) — แค่จัดรูป
 */
export function buildCashReport(view: DailyCashView, shopName: string): string {
  const [y, m, d] = view.businessDate.split("-");
  const dateTh = `${Number(d)}/${m}/${Number(y) + 543}`;

  const lines: string[] = [
    `${shopName} — รายงานเงินสด`,
    `วันที่ ${dateTh}`,
    "",
    `💵 เงินสดยกมา: ${B(view.openingCash)}`,
  ];

  if (view.expenseLines.length > 0) {
    lines.push("", "🧾 รายจ่ายเงินสด");
    for (const e of view.expenseLines) lines.push(`• ${e.note ?? e.category} ${B(e.amount)}`);
    lines.push(`รวมรายจ่าย: ${B(view.cashExpenses)}`);
    lines.push(
      "",
      `เงินสดหลังหักรายจ่าย: ${B(
        centsToDecimalString(toCents(view.openingCash ?? "0") - toCents(view.cashExpenses)),
      )}`,
    );
  }

  lines.push("", `💰 ยอดขายเงินสดวันนี้: ${B(view.cashSales)}`);

  for (const mv of view.movementLines) {
    lines.push(
      mv.movementType === "cash_in"
        ? `➕ เติมเงินสด: ${B(mv.amount)} (${mv.reason})`
        : `➖ ถอนออก: ${B(mv.amount)} (${mv.reason})`,
    );
  }

  const diff = Number(view.difference ?? 0);
  lines.push(
    "",
    `💵 เงินสดที่ควรมี: ${B(view.expectedCash)}`,
    `👛 เงินสดที่นับจริง: ${B(view.actualCash)}`,
    `ผลต่าง: ${B(view.difference)} ${diff === 0 ? "✅" : "⚠️"}`,
    "",
    `สถานะ: ${diff === 0 ? "เงินสดตรง" : diff < 0 ? `เงินสดขาด ${B(String(Math.abs(diff)))}` : `เงินสดเกิน ${B(view.difference)}`}`,
    `ผู้ตรวจ: ${view.countedByName ?? "-"}`,
    `หมายเหตุ: ${view.differenceReason ?? "ไม่มี"}`,
  );

  return lines.join("\n");
}
