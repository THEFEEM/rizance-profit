import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { centsToDecimalString, toCents } from "@/lib/money";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { hashToken } from "@/lib/hr-employee-queries";

/**
 * Staff App รอบ A — ข้อมูลหน้าแรกของพนักงานใน request เดียว
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) "ประมาณการ" ไม่ใช่ "เงินเดือน": ตัวเลขนี้คำนวณจากเวลาที่บันทึกแล้ว ×
 *    ค่าแรงในระบบ — ยังไม่ผ่านการตรวจของเจ้าของร้าน ไม่รวมโบนัส/หัก
 *    ทุกจอที่โชว์ต้องมีคำเตือนกำกับ (ฝั่ง UI บังคับไว้แล้ว)
 * 2) ใช้กติกาเดียวกับ payroll engine (Phase 4) เป๊ะ — อัตราของแต่ละวัน
 *    มาจาก employee_wage_history · OT × ot_multiplier · daily นับวัน
 *    ไม่ให้ตัวเลขสองที่ไม่ตรงกันจนพนักงานไม่เชื่อ
 * 3) กะที่ยังไม่ปิด (กำลังทำงาน) คิดเป็น "ประมาณการวันนี้" แยกออกมา
 *    ให้ UI เดินนาฬิกาต่อเองแบบ optimistic — server ส่งจุดตั้งต้นให้
 * 4) เพื่อนร่วมกะ: ชื่อ + ตำแหน่งเท่านั้น ไม่มีค่าแรง/เบอร์/ชั่วโมง
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export type StaffOverview = {
  employee: {
    name: string;
    nickname: string | null;
    position: string | null;
    branchName: string | null;
    wageType: "hourly" | "daily" | "monthly";
    wageRate: string;
  };
  shopName: string;
  /** เวลาเซิร์ฟเวอร์ตอนตอบ — UI ใช้ชดเชยนาฬิกาเครื่องที่ตั้งเพี้ยน */
  serverTime: string;
  businessDate: string;

  /** กำลังทำงานอยู่ไหม (นาฬิกาเดินจากตรงนี้) */
  active: {
    clockInAt: string;
    lateMinutes: number | null;
    /** เงินที่ได้แล้วจนถึง serverTime ของกะนี้ (hourly เท่านั้น · อื่น ๆ = null) */
    earnedSoFar: string | null;
    /** อัตราต่อชั่วโมงที่ใช้คิดตอนนี้ */
    hourlyRate: string | null;
  } | null;

  todayShift: {
    startMin: number;
    endMin: number;
    status: string;
    branchName: string | null;
  } | null;

  /** กะถัดไป (วันหน้า) — ไว้โชว์ตอนยังไม่เข้างาน */
  nextShift: { businessDate: string; startMin: number; endMin: number } | null;

  /** คนที่มีกะวันเดียวกัน (ไม่รวมตัวเอง) — ชื่อ + ตำแหน่งเท่านั้น */
  teamToday: { name: string; position: string | null; startMin: number; endMin: number }[];

  /** สรุปงวดปัจจุบัน — ทั้งหมดเป็นประมาณการ */
  period: {
    start: string;
    end: string;
    minutes: number;
    otMinutes: number;
    shifts: number;
    estimatedPay: string;
    avgHourlyRate: string | null;
  };

  /** สัปดาห์นี้ (จันทร์–อาทิตย์ตามวันขาย) */
  week: { minutes: number; estimatedPay: string };

  /** งวดที่ปิดบัญชีแล้ว = เลขจริงจาก payroll (ไม่ใช่ประมาณการ) */
  paid: { code: string; periodStart: string; periodEnd: string; netPay: string }[];

  /** ของที่พนักงานต้องจัดการเอง/รู้ไว้ */
  todo: {
    kind: "missing_clock_out" | "adjusted_by_shop" | "leave_pending" | "leave_rejected";
    businessDate: string;
    detail: string | null;
  }[];
};

type EmpRow = {
  id: string;
  user_id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  branch_id: string | null;
  branch_name: string | null;
  wage_type: "hourly" | "daily" | "monthly";
  wage_rate: string;
  shop_name: string;
};

async function employeeByToken(token: string): Promise<EmpRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<EmpRow>(
    `SELECT e.id, e.user_id, e.name, e.nickname, e.position, e.branch_id,
            b.name AS branch_name, e.wage_type, e.wage_rate::text AS wage_rate,
            u.shop_name
     FROM employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE e.token_hash = $1 AND e.token_expires_at > now() AND e.status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/** งวดปัจจุบันตาม hr_settings.payroll_cycle (MVP: monthly / semimonthly / weekly) */
function currentPeriod(cycle: string, today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

  if (cycle === "weekly") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = (dt.getUTCDay() + 6) % 7; // จันทร์ = 0
    const start = new Date(dt);
    start.setUTCDate(dt.getUTCDate() - dow);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (cycle === "semimonthly") {
    return d <= 15
      ? { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` }
      : { start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
}

function weekRange(today: string): { start: string; end: string } {
  return currentPeriod("weekly", today);
}

type SumRow = {
  minutes: number;
  ot_minutes: number;
  days: number;
  pay_cents: number;
};

/**
 * รวมเงินประมาณการของช่วงวันที่ — กติกาเดียวกับ payroll engine:
 * อัตราของแต่ละวันมาจาก wage history (แถวล่าสุดก่อนสิ้นวันนั้น)
 * hourly: นาที÷60×อัตรา + OT×multiplier · daily: นับวัน × อัตรา
 * monthly: ไม่ประมาณรายวัน (เงินเดือนคงที่) → คืน 0 และ UI ไม่โชว์ประมาณการ
 */
async function sumRange(
  employeeId: string,
  wageType: string,
  from: string,
  to: string,
  otMultiplier: number,
): Promise<SumRow> {
  const { rows } = await pool.query<{
    minutes: string; ot_minutes: string; days: string; pay: string;
  }>(
    `SELECT
       COALESCE(SUM(a.regular_minutes), 0)::text AS minutes,
       COALESCE(SUM(a.ot_minutes), 0)::text AS ot_minutes,
       COUNT(DISTINCT a.business_date)::text AS days,
       COALESCE(SUM(
         CASE WHEN $4 = 'hourly' THEN
           ROUND(a.regular_minutes * COALESCE(wh.wage_rate, e.wage_rate) / 60.0
                 + a.ot_minutes * COALESCE(wh.wage_rate, e.wage_rate) * $5::numeric / 60.0, 2)
         ELSE 0 END
       ), 0)::text AS pay
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN LATERAL (
       SELECT wage_rate FROM employee_wage_history h
       WHERE h.employee_id = a.employee_id
         AND h.recorded_at < (a.business_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
       ORDER BY h.recorded_at DESC LIMIT 1
     ) wh ON true
     WHERE a.employee_id = $1
       AND a.business_date BETWEEN $2::date AND $3::date
       AND a.status IN ('completed', 'adjusted')
       AND a.clock_out_at IS NOT NULL`,
    [employeeId, from, to, wageType, String(otMultiplier)],
  );

  const r = rows[0];
  let payCents = toCents(r?.pay ?? "0");

  // daily: คิดจากจำนวน "วันที่มาทำงาน" × อัตราของวันนั้น
  if (wageType === "daily") {
    const { rows: dayRows } = await pool.query<{ pay: string }>(
      `SELECT COALESCE(SUM(rate), 0)::text AS pay FROM (
         SELECT DISTINCT ON (a.business_date)
                COALESCE(wh.wage_rate, e.wage_rate) AS rate
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN LATERAL (
           SELECT wage_rate FROM employee_wage_history h
           WHERE h.employee_id = a.employee_id
             AND h.recorded_at < (a.business_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
           ORDER BY h.recorded_at DESC LIMIT 1
         ) wh ON true
         WHERE a.employee_id = $1 AND a.business_date BETWEEN $2::date AND $3::date
           AND a.status IN ('completed', 'adjusted') AND a.clock_out_at IS NOT NULL
         ORDER BY a.business_date
       ) d`,
      [employeeId, from, to],
    );
    payCents = toCents(dayRows[0]?.pay ?? "0");
  }

  return {
    minutes: Number(r?.minutes ?? 0),
    ot_minutes: Number(r?.ot_minutes ?? 0),
    days: Number(r?.days ?? 0),
    pay_cents: payCents,
  };
}

export async function getStaffOverview(token: string): Promise<StaffOverview | null> {
  const emp = await employeeByToken(token);
  if (!emp) return null;

  const cutoff = await getDayCutoffHour(emp.user_id);
  const bizDate = businessDate(cutoff);

  const { rows: settings } = await pool.query<{
    ot_multiplier: string; payroll_cycle: string;
  }>(
    `SELECT ot_multiplier::text, payroll_cycle FROM hr_settings WHERE user_id = $1`,
    [emp.user_id],
  );
  const otMultiplier = Number(settings[0]?.ot_multiplier ?? 1.5);
  const cycle = settings[0]?.payroll_cycle ?? "monthly";
  const period = currentPeriod(cycle, bizDate);
  const week = weekRange(bizDate);

  const [
    { rows: activeRows },
    { rows: shiftRows },
    { rows: nextRows },
    { rows: teamRows },
    periodSum,
    weekSum,
    { rows: paidRows },
    { rows: todoRows },
  ] = await Promise.all([
    pool.query<{ clock_in_at: string; late_minutes: number | null; rate: string }>(
      `SELECT a.clock_in_at::text AS clock_in_at, a.late_minutes,
              COALESCE(wh.wage_rate, e.wage_rate)::text AS rate
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN LATERAL (
         SELECT wage_rate FROM employee_wage_history h
         WHERE h.employee_id = a.employee_id
           AND h.recorded_at < (a.business_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
         ORDER BY h.recorded_at DESC LIMIT 1
       ) wh ON true
       WHERE a.employee_id = $1 AND a.clock_out_at IS NULL AND a.status = 'working'`,
      [emp.id],
    ),
    pool.query<{ start_min: number; end_min: number; status: string; branch_name: string | null }>(
      `SELECT sh.start_min, sh.end_min, sh.status, b.name AS branch_name
       FROM shifts sh LEFT JOIN branches b ON b.id = sh.branch_id
       WHERE sh.employee_id = $1 AND sh.business_date = $2::date
         AND sh.status <> 'cancelled'
       ORDER BY sh.start_min LIMIT 1`,
      [emp.id, bizDate],
    ),
    pool.query<{ business_date: string; start_min: number; end_min: number }>(
      `SELECT business_date::text AS business_date, start_min, end_min
       FROM shifts
       WHERE employee_id = $1 AND business_date > $2::date
         AND status NOT IN ('cancelled', 'absent')
       ORDER BY business_date, start_min LIMIT 1`,
      [emp.id, bizDate],
    ),
    pool.query<{ name: string; position: string | null; start_min: number; end_min: number }>(
      `SELECT COALESCE(e.nickname, e.name) AS name, e.position, sh.start_min, sh.end_min
       FROM shifts sh JOIN employees e ON e.id = sh.employee_id
       WHERE sh.user_id = $1 AND sh.business_date = $2::date
         AND sh.employee_id <> $3 AND sh.status NOT IN ('cancelled', 'absent')
       ORDER BY sh.start_min LIMIT 12`,
      [emp.user_id, bizDate, emp.id],
    ),
    sumRange(emp.id, emp.wage_type, period.start, period.end, otMultiplier),
    sumRange(emp.id, emp.wage_type, week.start, week.end, otMultiplier),
    pool.query<{
      period_start: string; period_end: string; net_pay: string;
    }>(
      `SELECT p.period_start::text AS period_start, p.period_end::text AS period_end,
              pi.net_pay::text AS net_pay
       FROM payroll_items pi JOIN payroll_periods p ON p.id = pi.period_id
       WHERE pi.employee_id = $1 AND p.status = 'posted'
       ORDER BY p.period_start DESC LIMIT 6`,
      [emp.id],
    ),
    pool.query<{ kind: string; business_date: string; detail: string | null }>(
      `SELECT 'missing_clock_out'::text AS kind, business_date::text AS business_date,
              NULL::text AS detail
       FROM attendance
       WHERE employee_id = $1 AND clock_out_at IS NULL AND status = 'working'
         AND business_date < $2::date
       UNION ALL
       SELECT 'adjusted_by_shop', a.business_date::text,
              (SELECT adj.reason FROM attendance_adjustments adj
               WHERE adj.attendance_id = a.id ORDER BY adj.created_at DESC LIMIT 1)
       FROM attendance a
       WHERE a.employee_id = $1 AND a.status = 'adjusted'
         AND a.business_date >= $2::date - 14
       UNION ALL
       SELECT 'leave_pending', start_date::text, leave_type
       FROM leave_requests WHERE employee_id = $1 AND status = 'pending'
       UNION ALL
       SELECT 'leave_rejected', start_date::text, review_note
       FROM leave_requests WHERE employee_id = $1 AND status = 'rejected'
         AND reviewed_at > now() - interval '7 days'
       ORDER BY business_date DESC LIMIT 10`,
      [emp.id, bizDate],
    ),
  ]);

  // เงินที่ได้แล้วของกะที่กำลังทำอยู่ (hourly เท่านั้น — daily/monthly ไม่เดินตามวินาที)
  let active: StaffOverview["active"] = null;
  if (activeRows[0]) {
    const rateCents = toCents(activeRows[0].rate);
    const minutes = Math.max(
      0,
      Math.floor((Date.now() - new Date(activeRows[0].clock_in_at).getTime()) / 60000),
    );
    active = {
      clockInAt: activeRows[0].clock_in_at,
      lateMinutes: activeRows[0].late_minutes,
      earnedSoFar:
        emp.wage_type === "hourly"
          ? centsToDecimalString(Math.round((minutes * rateCents) / 60))
          : null,
      hourlyRate: emp.wage_type === "hourly" ? activeRows[0].rate : null,
    };
  }

  const periodHours = periodSum.minutes / 60;

  return {
    employee: {
      name: emp.name,
      nickname: emp.nickname,
      position: emp.position,
      branchName: emp.branch_name,
      wageType: emp.wage_type,
      wageRate: emp.wage_rate,
    },
    shopName: emp.shop_name,
    serverTime: new Date().toISOString(),
    businessDate: bizDate,
    active,
    todayShift: shiftRows[0]
      ? {
          startMin: shiftRows[0].start_min,
          endMin: shiftRows[0].end_min,
          status: shiftRows[0].status,
          branchName: shiftRows[0].branch_name,
        }
      : null,
    nextShift: nextRows[0]
      ? {
          businessDate: nextRows[0].business_date,
          startMin: nextRows[0].start_min,
          endMin: nextRows[0].end_min,
        }
      : null,
    teamToday: teamRows.map((t) => ({
      name: t.name,
      position: t.position,
      startMin: t.start_min,
      endMin: t.end_min,
    })),
    period: {
      start: period.start,
      end: period.end,
      minutes: periodSum.minutes,
      otMinutes: periodSum.ot_minutes,
      shifts: periodSum.days,
      estimatedPay: centsToDecimalString(periodSum.pay_cents),
      avgHourlyRate:
        periodHours > 0 && emp.wage_type === "hourly"
          ? centsToDecimalString(Math.round(periodSum.pay_cents / periodHours))
          : null,
    },
    week: {
      minutes: weekSum.minutes,
      estimatedPay: centsToDecimalString(weekSum.pay_cents),
    },
    paid: paidRows.map((p) => ({
      code: p.period_start.endsWith("-01")
        ? `PAY-${p.period_start.slice(0, 7)}`
        : `PAY-${p.period_start}_${p.period_end}`,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      netPay: p.net_pay,
    })),
    todo: todoRows.map((t) => ({
      kind: t.kind as StaffOverview["todo"][number]["kind"],
      businessDate: t.business_date,
      detail: t.detail,
    })),
  };
}
