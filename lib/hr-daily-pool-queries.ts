import { pool } from "@/lib/db";
import { centsToDecimalString, toCents } from "@/lib/money";

/**
 * Payroll V1 — เงินกองกลางรายวัน (Daily Labor Pool Allocation)
 *
 * ═══ กติกาธุรกิจ (Ninenon) ═══════════════════════════════════
 *   เงินกองกลางของวัน ÷ จำนวนคนที่ "มาทำงานจริง" = เงินของแต่ละคน
 *   ไม่ใช่ค่าแรงรายชั่วโมง · คนไม่มา = ฿0 และเงินส่วนนั้นเฉลี่ยให้คนที่มา
 *   ผู้จัดการคิดแยก: อัตรารายวันคงที่ ไม่ดึงจากกองกลาง ไม่เฉลี่ยคืน
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) invariant: Σ allocation = pool เสมอ (เมื่อมีคนมาอย่างน้อย 1)
 *    เศษสตางค์กระจายแบบ largest-remainder — ห้ามให้ 133.33×3 = 399.99
 * 2) ไม่มีใครมา → allocation ทุกคน = 0 · เงินทั้งก้อนเป็น unallocated
 *    (ไม่แจกให้คนที่ไม่มาเด็ดขาด)
 * 3) มาสาย/ออกก่อน = ยังนับ present เต็ม (V1 ไม่ prorate) แต่ข้อมูลเวลา
 *    ยังเก็บครบใน attendance เหมือนเดิม
 * 4) ลา: ได้เงินเฉพาะประเภทที่เจ้าของร้านตั้งไว้ใน paid_leave_types
 *    (default ว่าง = ลาไม่ได้เงิน) — ระบบไม่เดาแทน
 * 5) ค่าแรงรายชั่วโมงเดิมไม่ถูกแตะ — คนละโหมดกัน
 */

// ── engine (pure — เทสได้โดยไม่ต้องมี DB) ──────────────────────

/**
 * แบ่งเงินกองกลางเป็นสตางค์แบบ largest-remainder
 * คืน array ยาวเท่า n — ผลรวมเท่ากับ poolCents เป๊ะเสมอ
 * เศษตกกับคนท้าย ๆ ของลิสต์ (เรียง employeeId มาก่อนแล้ว = deterministic)
 */
export function splitPoolCents(poolCents: number, n: number): number[] {
  if (n <= 0 || poolCents <= 0) return new Array(Math.max(0, n)).fill(0);
  const base = Math.floor(poolCents / n);
  const remainder = poolCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i >= n - remainder ? 1 : 0));
}

export type DayMemberInput = {
  employeeId: string;
  /** present = ได้ส่วนแบ่ง · absent/leave_unpaid = ฿0 · leave_paid = ได้ส่วนแบ่ง */
  status: "present" | "absent" | "leave_paid" | "leave_unpaid";
  isManager: boolean;
};

export type DayAllocation = {
  employeeId: string;
  kind: "staff" | "manager";
  status: DayMemberInput["status"];
  allocation: string;
};

export type DayResult = {
  poolAmount: string;
  eligibleCount: number;
  allocations: DayAllocation[];
  staffTotal: string;
  managerTotal: string;
  /** เงินกองกลางที่ไม่มีใครรับ (ไม่มีคนมาเลย) */
  unallocated: string;
};

/**
 * คำนวณของหนึ่งวัน — ฟังก์ชันบริสุทธิ์
 * staff: แบ่งกองกลาง · manager: อัตรารายวันคงที่ (มาถึงได้ · ไม่มาได้ 0)
 */
export function calculateDailyStaffAllocation(input: {
  poolAmount: string | number;
  managerDailyRate: string | number;
  members: DayMemberInput[];
}): DayResult {
  const poolCents = toCents(input.poolAmount);
  const mgrCents = toCents(input.managerDailyRate);

  const staff = input.members.filter((m) => !m.isManager);
  const managers = input.members.filter((m) => m.isManager);

  const eligible = staff
    .filter((m) => m.status === "present" || m.status === "leave_paid")
    .sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));

  const shares = splitPoolCents(poolCents, eligible.length);
  const byId = new Map<string, number>();
  eligible.forEach((m, i) => byId.set(m.employeeId, shares[i]));

  const allocations: DayAllocation[] = [
    ...staff.map((m) => ({
      employeeId: m.employeeId,
      kind: "staff" as const,
      status: m.status,
      allocation: centsToDecimalString(byId.get(m.employeeId) ?? 0),
    })),
    ...managers.map((m) => ({
      employeeId: m.employeeId,
      kind: "manager" as const,
      status: m.status,
      allocation: centsToDecimalString(
        m.status === "present" || m.status === "leave_paid" ? mgrCents : 0,
      ),
    })),
  ];

  const staffTotalCents = shares.reduce((s, c) => s + c, 0);
  const managerTotalCents = managers.filter(
    (m) => m.status === "present" || m.status === "leave_paid",
  ).length * mgrCents;

  return {
    poolAmount: centsToDecimalString(poolCents),
    eligibleCount: eligible.length,
    allocations,
    staffTotal: centsToDecimalString(staffTotalCents),
    managerTotal: centsToDecimalString(managerTotalCents),
    unallocated: centsToDecimalString(
      eligible.length === 0 ? poolCents : poolCents - staffTotalCents,
    ),
  };
}

// ── settings / config ──────────────────────────────────────────

export type PoolSettings = {
  payrollMode: "hourly" | "daily_pool";
  managerDailyRate: string;
  paidLeaveTypes: string[];
};

export async function getPoolSettings(userId: string): Promise<PoolSettings> {
  const { rows } = await pool.query<{
    payroll_mode: "hourly" | "daily_pool";
    manager_daily_rate: string;
    paid_leave_types: string[];
  }>(
    `SELECT payroll_mode, manager_daily_rate::text, paid_leave_types
     FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    payrollMode: rows[0]?.payroll_mode ?? "hourly",
    managerDailyRate: rows[0]?.manager_daily_rate ?? "200.00",
    paidLeaveTypes: rows[0]?.paid_leave_types ?? [],
  };
}

export async function updatePoolSettings(
  userId: string,
  input: Partial<{
    payrollMode: "hourly" | "daily_pool";
    managerDailyRate: number;
    paidLeaveTypes: string[];
  }>,
): Promise<void> {
  await pool.query(
    `UPDATE hr_settings SET
       payroll_mode = COALESCE($2, payroll_mode),
       manager_daily_rate = COALESCE($3, manager_daily_rate),
       paid_leave_types = COALESCE($4::jsonb, paid_leave_types),
       updated_at = now()
     WHERE user_id = $1`,
    [
      userId,
      input.payrollMode ?? null,
      input.managerDailyRate?.toFixed(2) ?? null,
      input.paidLeaveTypes ? JSON.stringify(input.paidLeaveTypes) : null,
    ],
  );
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
     VALUES ($1, 'owner', 'payroll_settings_changed', $2)`,
    [userId, JSON.stringify(input)],
  );
}

export type PoolConfigRow = { dayOfWeek: number; poolAmount: string; effectiveFrom: string };

/** เงินกองกลางที่ "มีผลอยู่ตอนนี้" ของทั้ง 7 วัน */
export async function getPoolConfig(userId: string): Promise<PoolConfigRow[]> {
  const { rows } = await pool.query<{
    day_of_week: number; pool_amount: string; effective_from: string;
  }>(
    `SELECT DISTINCT ON (day_of_week)
            day_of_week, pool_amount::text, effective_from::text
     FROM daily_pool_config
     WHERE user_id = $1 AND effective_from <= CURRENT_DATE
     ORDER BY day_of_week, effective_from DESC`,
    [userId],
  );
  return rows.map((r) => ({
    dayOfWeek: r.day_of_week,
    poolAmount: r.pool_amount,
    effectiveFrom: r.effective_from,
  }));
}

/** ตั้งเงินกองกลางใหม่ — เวอร์ชันใหม่ ไม่ทับของเก่า (payroll อดีตไม่เปลี่ยน) */
export async function setPoolAmount(
  userId: string,
  dayOfWeek: number,
  amount: number,
  effectiveFrom: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO daily_pool_config (user_id, day_of_week, pool_amount, effective_from)
     VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (user_id, day_of_week, effective_from)
     DO UPDATE SET pool_amount = EXCLUDED.pool_amount`,
    [userId, dayOfWeek, amount.toFixed(2), effectiveFrom],
  );
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, action, detail)
     VALUES ($1, 'owner', 'daily_pool_changed', $2)`,
    [userId, JSON.stringify({ dayOfWeek, amount, effectiveFrom })],
  );
}

/** เงินกองกลางที่ใช้กับวันนั้นจริง ๆ (เวอร์ชันที่มีผล ณ วันนั้น) */
async function poolForDate(userId: string, date: string): Promise<string> {
  const { rows } = await pool.query<{ pool_amount: string }>(
    `SELECT pool_amount::text FROM daily_pool_config
     WHERE user_id = $1
       AND day_of_week = EXTRACT(DOW FROM $2::date)::int
       AND effective_from <= $2::date
     ORDER BY effective_from DESC LIMIT 1`,
    [userId, date],
  );
  return rows[0]?.pool_amount ?? "0";
}

// ── คำนวณ + บันทึกรายวัน ───────────────────────────────────────

/**
 * ใครควรได้รับพิจารณาในวันนั้น = คนที่มีกะ หรือมีการลงเวลาจริง
 * present = มีแถว attendance completed/adjusted (หรือกำลังทำงานอยู่)
 * leave_* = มีใบลาอนุมัติวันนั้น (แยกจ่าย/ไม่จ่ายตาม paid_leave_types)
 * absent  = มีกะแต่ไม่มีเวลาและไม่ได้ลา
 */
async function membersOfDay(
  userId: string,
  date: string,
  paidLeaveTypes: string[],
): Promise<DayMemberInput[]> {
  const { rows } = await pool.query<{
    employee_id: string; hr_role: "staff" | "manager";
    has_attendance: boolean; leave_type: string | null;
  }>(
    `SELECT e.id AS employee_id, e.hr_role,
            EXISTS (
              SELECT 1 FROM attendance a
              WHERE a.employee_id = e.id AND a.business_date = $2::date
                AND a.status IN ('working', 'completed', 'adjusted')
            ) AS has_attendance,
            (SELECT l.leave_type FROM leave_requests l
             WHERE l.employee_id = e.id AND l.status = 'approved'
               AND $2::date BETWEEN l.start_date AND l.end_date
             LIMIT 1) AS leave_type
     FROM employees e
     WHERE e.user_id = $1 AND e.status = 'active'
       AND (
         EXISTS (SELECT 1 FROM shifts sh
                 WHERE sh.employee_id = e.id AND sh.business_date = $2::date
                   AND sh.status NOT IN ('cancelled'))
         OR EXISTS (SELECT 1 FROM attendance a2
                    WHERE a2.employee_id = e.id AND a2.business_date = $2::date
                      AND a2.status <> 'cancelled')
       )
     ORDER BY e.id`,
    [userId, date],
  );

  return rows.map((r) => ({
    employeeId: r.employee_id,
    isManager: r.hr_role === "manager",
    status: r.has_attendance
      ? "present"
      : r.leave_type
        ? paidLeaveTypes.includes(r.leave_type)
          ? "leave_paid"
          : "leave_unpaid"
        : "absent",
  }));
}

export type DayBreakdown = DayResult & {
  businessDate: string;
  rows: {
    employeeId: string;
    employeeName: string;
    kind: "staff" | "manager";
    status: DayMemberInput["status"];
    allocation: string;
  }[];
};

/** คำนวณของวันหนึ่ง (ไม่เขียน DB) — ใช้โชว์ breakdown */
export async function computeDay(userId: string, date: string): Promise<DayBreakdown> {
  const settings = await getPoolSettings(userId);
  const [poolAmount, members] = await Promise.all([
    poolForDate(userId, date),
    membersOfDay(userId, date, settings.paidLeaveTypes),
  ]);
  const result = calculateDailyStaffAllocation({
    poolAmount,
    managerDailyRate: settings.managerDailyRate,
    members,
  });

  const names = new Map<string, string>();
  if (members.length > 0) {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, COALESCE(nickname, name) AS name FROM employees
       WHERE id = ANY($1::uuid[])`,
      [members.map((m) => m.employeeId)],
    );
    rows.forEach((r) => names.set(r.id, r.name));
  }

  return {
    ...result,
    businessDate: date,
    rows: result.allocations.map((a) => ({
      employeeId: a.employeeId,
      employeeName: names.get(a.employeeId) ?? "—",
      kind: a.kind,
      status: a.status,
      allocation: a.allocation,
    })),
  };
}

/** คำนวณ + บันทึกลง daily_allocations (คำนวณซ้ำได้ ทับของเดิมวันนั้น) */
export async function persistDay(userId: string, date: string): Promise<DayBreakdown> {
  const day = await computeDay(userId, date);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const a of day.allocations) {
      await client.query(
        `INSERT INTO daily_allocations
           (user_id, employee_id, business_date, kind, pool_amount,
            eligible_count, allocation_amount, attendance_status,
            branch_id, calculated_at)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8,
                 (SELECT branch_id FROM employees WHERE id = $2), now())
         ON CONFLICT (user_id, business_date, employee_id) DO UPDATE SET
           kind = EXCLUDED.kind, pool_amount = EXCLUDED.pool_amount,
           eligible_count = EXCLUDED.eligible_count,
           allocation_amount = EXCLUDED.allocation_amount,
           attendance_status = EXCLUDED.attendance_status,
           calculated_at = now()`,
        [userId, a.employeeId, date, a.kind,
         a.kind === "staff" ? day.poolAmount : "0",
         day.eligibleCount, a.allocation, a.status],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return day;
}

// ── สรุปช่วง (สัปดาห์/งวด) ─────────────────────────────────────

export type PeriodPoolSummary = {
  start: string;
  end: string;
  days: {
    businessDate: string;
    poolAmount: string;
    eligibleCount: number;
    allocationEach: string | null;
    staffTotal: string;
    managerTotal: string;
    unallocated: string;
  }[];
  perEmployee: {
    employeeId: string;
    employeeName: string;
    kind: "staff" | "manager";
    daysWorked: number;
    total: string;
    byDate: Record<string, string>;
  }[];
  staffTotal: string;
  managerTotal: string;
  grandTotal: string;
  unallocatedTotal: string;
};

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** สรุปทั้งช่วง — คำนวณสด (ไม่แตะ DB เขียน) เพื่อให้ preview ตรงเสมอ */
export async function summarizePeriod(
  userId: string,
  start: string,
  end: string,
): Promise<PeriodPoolSummary> {
  const dates = eachDate(start, end);
  const days = await Promise.all(dates.map((d) => computeDay(userId, d)));

  const perEmp = new Map<string, PeriodPoolSummary["perEmployee"][number]>();
  let staffCents = 0;
  let mgrCents = 0;
  let unallocCents = 0;

  for (const day of days) {
    staffCents += toCents(day.staffTotal);
    mgrCents += toCents(day.managerTotal);
    if (day.eligibleCount === 0) unallocCents += toCents(day.unallocated);

    for (const r of day.rows) {
      const cents = toCents(r.allocation);
      let e = perEmp.get(r.employeeId);
      if (!e) {
        e = {
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          kind: r.kind,
          daysWorked: 0,
          total: "0.00",
          byDate: {},
        };
        perEmp.set(r.employeeId, e);
      }
      if (cents > 0) {
        e.daysWorked += 1;
        e.byDate[day.businessDate] = r.allocation;
        e.total = centsToDecimalString(toCents(e.total) + cents);
      }
    }
  }

  return {
    start,
    end,
    days: days.map((d) => ({
      businessDate: d.businessDate,
      poolAmount: d.poolAmount,
      eligibleCount: d.eligibleCount,
      allocationEach:
        d.eligibleCount > 0
          ? centsToDecimalString(Math.floor(toCents(d.poolAmount) / d.eligibleCount))
          : null,
      staffTotal: d.staffTotal,
      managerTotal: d.managerTotal,
      unallocated: d.unallocated,
    })),
    perEmployee: [...perEmp.values()]
      .filter((e) => toCents(e.total) > 0)
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "manager" ? 1 : -1)),
    staffTotal: centsToDecimalString(staffCents),
    managerTotal: centsToDecimalString(mgrCents),
    grandTotal: centsToDecimalString(staffCents + mgrCents),
    unallocatedTotal: centsToDecimalString(unallocCents),
  };
}

/** ยอดของพนักงานคนเดียวในช่วง — ใช้ในแอปพนักงาน (เห็นเฉพาะตัวเอง) */
export async function employeePeriodPool(
  employeeId: string,
  userId: string,
  start: string,
  end: string,
): Promise<{
  total: string;
  daysWorked: number;
  days: { businessDate: string; status: string; allocation: string }[];
}> {
  const summary = await summarizePeriod(userId, start, end);
  const mine = summary.perEmployee.find((e) => e.employeeId === employeeId);
  const days = Object.entries(mine?.byDate ?? {})
    .map(([businessDate, allocation]) => ({
      businessDate,
      status: "present",
      allocation,
    }))
    .sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1));
  return {
    total: mine?.total ?? "0.00",
    daysWorked: mine?.daysWorked ?? 0,
    days,
  };
}
