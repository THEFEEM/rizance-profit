import { createHash, randomBytes } from "node:crypto";
import { pool } from "@/lib/db";

/**
 * HR Phase 1 (0077) — ทะเบียนพนักงาน + สาขา + Staff Identity
 *
 * ═══ Staff Identity — หลักที่ยึด ═══════════════════════════════
 * 1) token จริงมีอยู่ 2 ที่เท่านั้น: ใน response ครั้งที่สร้าง/rotate และ
 *    ในมือถือพนักงาน — DB เก็บแค่ sha256 hash (DB หลุด = ลิงก์ไม่หลุด)
 * 2) ไม่ permanent: หมดอายุตาม hr_settings.token_ttl_days (default 180 วัน)
 *    rotate เมื่อไหร่ token เดิมตายทันที
 * 3) พนักงาน inactive/suspended = ลิงก์ใช้ไม่ได้ทันที ไม่ต้องรอหมดอายุ
 * 4) ทุกการสร้าง/rotate/เปลี่ยนสถานะ ลง hr_audit_logs
 */

// ── types ──────────────────────────────────────────────────────

export type HrBranch = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type HrEmployee = {
  id: string;
  branchId: string | null;
  branchName: string | null;
  code: string | null;
  name: string;
  nickname: string | null;
  phone: string | null;
  photoUrl: string | null;
  position: string | null;
  employmentType: "full_time" | "part_time" | "temporary" | "intern";
  startDate: string | null;
  wageType: "hourly" | "daily" | "monthly";
  wageRate: string;
  status: "active" | "inactive" | "suspended";
  hrRole: "staff" | "manager";
  emergencyName: string | null;
  emergencyPhone: string | null;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
};

export type EmployeeInput = {
  branchId?: string | null;
  code?: string | null;
  name: string;
  nickname?: string | null;
  phone?: string | null;
  position?: string | null;
  employmentType?: HrEmployee["employmentType"];
  startDate?: string | null;
  wageType?: HrEmployee["wageType"];
  wageRate?: number;
  status?: HrEmployee["status"];
  hrRole?: HrEmployee["hrRole"];
  emergencyName?: string | null;
  emergencyPhone?: string | null;
};

/** โปรไฟล์ที่พนักงานเห็นเอง — เท่าที่จำเป็น ไม่มีข้อมูลร้าน/คนอื่น */
export type StaffSelfProfile = {
  employee: {
    name: string;
    nickname: string | null;
    position: string | null;
    employmentType: HrEmployee["employmentType"];
    startDate: string | null;
    wageType: HrEmployee["wageType"];
    wageRate: string;
    branchName: string | null;
  };
  shopName: string;
  tokenExpiresAt: string;
};

export class EmployeeCodeTakenError extends Error {}

// ── token helpers ──────────────────────────────────────────────

/** 32 ตัวอักษร base64url (~192 bits) — เกินพอสำหรับ capability URL */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

// ── mapping ────────────────────────────────────────────────────

type EmployeeRow = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  code: string | null;
  name: string;
  nickname: string | null;
  phone: string | null;
  photo_url: string | null;
  position: string | null;
  employment_type: HrEmployee["employmentType"];
  start_date: string | null;
  wage_type: HrEmployee["wageType"];
  wage_rate: string;
  status: HrEmployee["status"];
  hr_role: HrEmployee["hrRole"];
  emergency_name: string | null;
  emergency_phone: string | null;
  token_hash: string | null;
  token_expires_at: string | null;
  created_at: string;
};

const EMPLOYEE_SELECT = `
  e.id, e.branch_id, b.name AS branch_name, e.code, e.name, e.nickname,
  e.phone, e.photo_url, e.position, e.employment_type,
  e.start_date::text AS start_date, e.wage_type, e.wage_rate::text AS wage_rate,
  e.status, e.hr_role, e.emergency_name, e.emergency_phone,
  e.token_hash, e.token_expires_at::text AS token_expires_at,
  e.created_at::text AS created_at
  FROM employees e LEFT JOIN branches b ON b.id = e.branch_id`;

function mapEmployee(r: EmployeeRow): HrEmployee {
  return {
    id: r.id,
    branchId: r.branch_id,
    branchName: r.branch_name,
    code: r.code,
    name: r.name,
    nickname: r.nickname,
    phone: r.phone,
    photoUrl: r.photo_url,
    position: r.position,
    employmentType: r.employment_type,
    startDate: r.start_date,
    wageType: r.wage_type,
    wageRate: r.wage_rate,
    status: r.status,
    hrRole: r.hr_role,
    emergencyName: r.emergency_name,
    emergencyPhone: r.emergency_phone,
    hasToken: r.token_hash !== null,
    tokenExpiresAt: r.token_expires_at,
    createdAt: r.created_at,
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

async function tokenTtlDays(userId: string): Promise<number> {
  const { rows } = await pool.query<{ token_ttl_days: number }>(
    `SELECT token_ttl_days FROM hr_settings WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.token_ttl_days ?? 180;
}

// ── branches ───────────────────────────────────────────────────

export async function listBranches(userId: string): Promise<HrBranch[]> {
  const { rows } = await pool.query<{
    id: string; name: string; is_active: boolean; sort_order: number;
  }>(
    `SELECT id, name, is_active, sort_order FROM branches
     WHERE user_id = $1 ORDER BY sort_order, name`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order,
  }));
}

export async function createBranch(userId: string, name: string): Promise<HrBranch> {
  const { rows } = await pool.query<{ id: string; sort_order: number }>(
    `INSERT INTO branches (user_id, name, sort_order)
     VALUES ($1, $2,
       (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM branches WHERE user_id = $1))
     RETURNING id, sort_order`,
    [userId, name.trim()],
  );
  return { id: rows[0].id, name: name.trim(), isActive: true, sortOrder: rows[0].sort_order };
}

export async function updateBranch(
  userId: string,
  branchId: string,
  input: { name?: string; isActive?: boolean },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE branches SET
       name = COALESCE($3, name),
       is_active = COALESCE($4, is_active),
       updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, branchId, input.name?.trim() ?? null, input.isActive ?? null],
  );
  return (rowCount ?? 0) > 0;
}

// ── employees (owner) ──────────────────────────────────────────

export async function listEmployees(
  userId: string,
  opts?: { includeInactive?: boolean },
): Promise<HrEmployee[]> {
  const { rows } = await pool.query<EmployeeRow>(
    `SELECT ${EMPLOYEE_SELECT}
     WHERE e.user_id = $1 ${opts?.includeInactive ? "" : "AND e.status = 'active'"}
     ORDER BY e.status = 'active' DESC, e.name`,
    [userId],
  );
  return rows.map(mapEmployee);
}

export async function getEmployee(
  userId: string,
  employeeId: string,
): Promise<HrEmployee | null> {
  const { rows } = await pool.query<EmployeeRow>(
    `SELECT ${EMPLOYEE_SELECT} WHERE e.user_id = $1 AND e.id = $2`,
    [userId, employeeId],
  );
  return rows[0] ? mapEmployee(rows[0]) : null;
}

/** สร้างพนักงาน + ออก staff link — token คืนครั้งเดียว เก็บใหม่ไม่ได้ */
export async function createEmployee(
  userId: string,
  input: EmployeeInput,
): Promise<{ employee: HrEmployee; staffToken: string }> {
  const token = generateToken();
  const ttl = await tokenTtlDays(userId);
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO employees
         (user_id, branch_id, code, name, nickname, phone, position,
          employment_type, start_date, wage_type, wage_rate, status, hr_role,
          emergency_name, emergency_phone,
          token_hash, token_expires_at, token_rotated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, now() + ($17 || ' days')::interval, now())
       RETURNING id`,
      [
        userId,
        input.branchId ?? null,
        input.code?.trim() || null,
        input.name.trim(),
        input.nickname?.trim() || null,
        input.phone?.trim() || null,
        input.position?.trim() || null,
        input.employmentType ?? "part_time",
        input.startDate ?? null,
        input.wageType ?? "hourly",
        (input.wageRate ?? 0).toFixed(2),
        input.status ?? "active",
        input.hrRole ?? "staff",
        input.emergencyName?.trim() || null,
        input.emergencyPhone?.trim() || null,
        hashToken(token),
        String(ttl),
      ],
    );
    const employee = (await getEmployee(userId, rows[0].id))!;
    await logHr(userId, "owner", employee.id, "employee_created", {
      name: employee.name, code: employee.code,
    });
    return { employee, staffToken: token };
  } catch (err) {
    if (
      (err as { code?: string; constraint?: string }).code === "23505" &&
      (err as { constraint?: string }).constraint === "idx_employees_user_code"
    ) {
      throw new EmployeeCodeTakenError();
    }
    throw err;
  }
}

export async function updateEmployee(
  userId: string,
  employeeId: string,
  input: Partial<EmployeeInput>,
): Promise<HrEmployee | null> {
  const before = await getEmployee(userId, employeeId);
  if (!before) return null;

  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [userId, employeeId];
  let i = 3;
  const push = (col: string, v: string | number | null) => {
    sets.push(`${col} = $${i}`);
    params.push(v);
    i += 1;
  };

  if (input.branchId !== undefined) push("branch_id", input.branchId);
  if (input.code !== undefined) push("code", input.code?.trim() || null);
  if (input.name !== undefined) push("name", input.name.trim());
  if (input.nickname !== undefined) push("nickname", input.nickname?.trim() || null);
  if (input.phone !== undefined) push("phone", input.phone?.trim() || null);
  if (input.position !== undefined) push("position", input.position?.trim() || null);
  if (input.employmentType !== undefined) push("employment_type", input.employmentType);
  if (input.startDate !== undefined) push("start_date", input.startDate);
  if (input.wageType !== undefined) push("wage_type", input.wageType);
  if (input.wageRate !== undefined) push("wage_rate", input.wageRate.toFixed(2));
  if (input.status !== undefined) push("status", input.status);
  if (input.hrRole !== undefined) push("hr_role", input.hrRole);
  if (input.emergencyName !== undefined)
    push("emergency_name", input.emergencyName?.trim() || null);
  if (input.emergencyPhone !== undefined)
    push("emergency_phone", input.emergencyPhone?.trim() || null);

  if (sets.length === 0) return before;
  sets.push("updated_at = now()");

  try {
    await pool.query(
      `UPDATE employees SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2`,
      params,
    );
  } catch (err) {
    if (
      (err as { code?: string; constraint?: string }).code === "23505" &&
      (err as { constraint?: string }).constraint === "idx_employees_user_code"
    ) {
      throw new EmployeeCodeTakenError();
    }
    throw err;
  }

  const after = (await getEmployee(userId, employeeId))!;
  if (input.status !== undefined && input.status !== before.status) {
    await logHr(userId, "owner", employeeId, "status_changed", {
      from: before.status, to: input.status,
    });
  } else {
    await logHr(userId, "owner", employeeId, "employee_updated");
  }
  return after;
}

/** rotate = token เดิมตายทันที ออกใหม่ + อายุใหม่ — คืน token ครั้งเดียว */
export async function rotateEmployeeToken(
  userId: string,
  employeeId: string,
): Promise<{ staffToken: string; tokenExpiresAt: string } | null> {
  const token = generateToken();
  const ttl = await tokenTtlDays(userId);
  const { rows } = await pool.query<{ token_expires_at: string }>(
    `UPDATE employees SET
       token_hash = $3,
       token_expires_at = now() + ($4 || ' days')::interval,
       token_rotated_at = now(),
       updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING token_expires_at::text AS token_expires_at`,
    [userId, employeeId, hashToken(token), String(ttl)],
  );
  if (!rows[0]) return null;
  await logHr(userId, "owner", employeeId, "token_rotated");
  return { staffToken: token, tokenExpiresAt: rows[0].token_expires_at };
}

// ── staff self-service (token) ─────────────────────────────────

/**
 * lookup จากลิงก์พนักงาน — เงื่อนไขครบในตัว query:
 * hash ตรง + ยังไม่หมดอายุ + สถานะ active เท่านั้น
 * คืน null ทุกกรณีที่ไม่ผ่าน (ฝั่ง route ตอบ 404 เดียว ไม่บอกเหตุผล
 * — ไม่ให้คนเดา token รู้ว่าใกล้เคียงแค่ไหน)
 */
export async function getStaffProfileByToken(
  token: string,
): Promise<StaffSelfProfile | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{
    name: string;
    nickname: string | null;
    position: string | null;
    employment_type: HrEmployee["employmentType"];
    start_date: string | null;
    wage_type: HrEmployee["wageType"];
    wage_rate: string;
    branch_name: string | null;
    shop_name: string;
    token_expires_at: string;
  }>(
    `SELECT e.name, e.nickname, e.position, e.employment_type,
            e.start_date::text AS start_date, e.wage_type,
            e.wage_rate::text AS wage_rate, b.name AS branch_name,
            u.shop_name, e.token_expires_at::text AS token_expires_at
     FROM employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE e.token_hash = $1
       AND e.token_expires_at > now()
       AND e.status = 'active'`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    employee: {
      name: r.name,
      nickname: r.nickname,
      position: r.position,
      employmentType: r.employment_type,
      startDate: r.start_date,
      wageType: r.wage_type,
      wageRate: r.wage_rate,
      branchName: r.branch_name,
    },
    shopName: r.shop_name,
    tokenExpiresAt: r.token_expires_at,
  };
}
