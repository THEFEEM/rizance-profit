import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";

/**
 * รหัสผู้จัดการ (0087) — ตั้ง / ตรวจ / เปลี่ยน
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) เก็บเฉพาะ bcrypt hash — ไม่มี PIN จริงอยู่ในฐานข้อมูลหรือในโค้ด
 * 2) ไม่มี default / master / fallback PIN ใด ๆ ทั้งสิ้น
 *    ร้านที่ยังไม่ตั้ง = manager_pin_hash IS NULL → ต้องตั้งเองก่อน
 * 3) นับครั้งที่ผิดใน DB ไม่ใช่หน่วยความจำ — serverless เปลี่ยน instance
 *    ตลอดเวลา ถ้านับในหน่วยความจำจะกันอะไรไม่ได้เลย
 * 4) การนับต้อง atomic (UPDATE ... RETURNING) ยิงพร้อมกันก็ไม่เพี้ยน
 * 5) ข้อความ error ไม่บอกว่า "PIN ถูกแต่โดนล็อก" — ไม่ช่วยคนเดา
 *
 * PIN 6 หลักมีแค่ 1,000,000 แบบ · ถ้าไม่มีด่านนับผิด เดาหมดได้ในไม่กี่นาที
 */

/** ผิดกี่ครั้งถึงล็อก — ที่เดียวในระบบ ห้ามกระจายไปตาม component */
export const MAX_FAILED_ATTEMPTS = 5;
/** ล็อกนานเท่าไร */
export const LOCKOUT_MINUTES = 15;

export type PinStatus =
  | { state: "not_set" }
  | { state: "locked"; retryAfterSeconds: number }
  | { state: "ready"; version: number };

export type VerifyResult =
  | { ok: true; version: number }
  | { ok: false; reason: "not_set" | "invalid" | "locked"; retryAfterSeconds?: number };

type SettingsRow = {
  manager_pin_hash: string | null;
  manager_pin_updated_at: Date | string | null;
  manager_pin_failed_attempts: number;
  manager_pin_locked_until: Date | string | null;
};

const epoch = (v: Date | string | null): number =>
  v == null ? 0 : Math.floor(new Date(v).getTime() / 1000);

async function loadSettings(userId: string): Promise<SettingsRow | null> {
  const { rows } = await pool.query<SettingsRow>(
    `SELECT manager_pin_hash, manager_pin_updated_at,
            manager_pin_failed_attempts, manager_pin_locked_until
     FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** PIN 6 หลักล้วน และไม่ใช่รูปแบบที่เดาง่ายจนไร้ความหมาย */
export function validatePinFormat(pin: string): { ok: true } | { ok: false; reason: string } {
  if (!/^\d{6}$/.test(pin)) return { ok: false, reason: "ต้องเป็นตัวเลข 6 หลัก" };
  // เลขซ้ำทั้งหมด เช่น 000000 / 111111
  if (/^(\d)\1{5}$/.test(pin)) return { ok: false, reason: "เลขซ้ำกันทั้งหมด เดาง่ายเกินไป" };
  // เรียงขึ้นหรือลง เช่น 123456 / 654321
  const digits = [...pin].map(Number);
  const asc = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const desc = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (asc || desc) return { ok: false, reason: "เลขเรียงกัน เดาง่ายเกินไป" };
  return { ok: true };
}

/** สถานะสำหรับหน้าจอ — ไม่คืน hash และไม่คืนอะไรที่ช่วยเดา PIN */
export async function pinStatus(userId: string): Promise<PinStatus> {
  const s = await loadSettings(userId);
  if (!s || !s.manager_pin_hash) return { state: "not_set" };
  const lockedUntil = s.manager_pin_locked_until
    ? new Date(s.manager_pin_locked_until).getTime()
    : 0;
  if (lockedUntil > Date.now()) {
    return { state: "locked", retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) };
  }
  return { state: "ready", version: epoch(s.manager_pin_updated_at) };
}

export class PinAlreadySetError extends Error {}
export class PinFormatError extends Error {}

/**
 * ตั้งรหัสครั้งแรก — ทำได้เฉพาะตอนที่ยังไม่มีรหัสเท่านั้น
 *
 * ⚠️ กัน race ด้วย WHERE manager_pin_hash IS NULL ในตัว UPDATE
 *    ถ้ามีสองคำขอพร้อมกัน จะมีแค่ใบเดียวที่สำเร็จ
 *    อีกใบไม่สามารถทับรหัสของคนแรกได้
 */
export async function setupPin(userId: string, pin: string): Promise<number> {
  const fmt = validatePinFormat(pin);
  if (!fmt.ok) throw new PinFormatError(fmt.reason);

  const hash = await bcrypt.hash(pin, 10);
  const { rows } = await pool.query<{ manager_pin_updated_at: Date | string }>(
    `UPDATE pos_shop_settings
     SET manager_pin_hash = $2,
         manager_pin_updated_at = now(),
         manager_pin_failed_attempts = 0,
         manager_pin_locked_until = NULL
     WHERE user_id = $1 AND manager_pin_hash IS NULL
     RETURNING manager_pin_updated_at`,
    [userId, hash],
  );
  if (!rows[0]) throw new PinAlreadySetError();
  return epoch(rows[0].manager_pin_updated_at);
}

/**
 * ตรวจรหัส
 *
 * ลำดับสำคัญ: เช็กล็อกก่อน → เทียบ hash → แล้วค่อยอัปเดตตัวนับ
 * ตัวนับเพิ่มแบบ atomic และตั้ง locked_until ในคำสั่งเดียว
 */
export async function verifyPin(userId: string, pin: string): Promise<VerifyResult> {
  const s = await loadSettings(userId);
  if (!s || !s.manager_pin_hash) return { ok: false, reason: "not_set" };

  const lockedUntil = s.manager_pin_locked_until
    ? new Date(s.manager_pin_locked_until).getTime()
    : 0;
  if (lockedUntil > Date.now()) {
    return {
      ok: false,
      reason: "locked",
      retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000),
    };
  }

  // รูปแบบผิดก็ยังต้องนับเป็นการเดาหนึ่งครั้ง ไม่งั้นคนเดาส่งค่ามั่ว ๆ ฟรีได้
  const matched =
    /^\d{6}$/.test(pin) && (await bcrypt.compare(pin, s.manager_pin_hash));

  if (matched) {
    await pool.query(
      `UPDATE pos_shop_settings
       SET manager_pin_failed_attempts = 0, manager_pin_locked_until = NULL
       WHERE user_id = $1`,
      [userId],
    );
    return { ok: true, version: epoch(s.manager_pin_updated_at) };
  }

  // เพิ่มตัวนับ + ล็อกถ้าถึงเกณฑ์ ในคำสั่งเดียว (กัน race)
  const { rows } = await pool.query<{ attempts: number; locked_until: Date | string | null }>(
    `UPDATE pos_shop_settings
     SET manager_pin_failed_attempts = manager_pin_failed_attempts + 1,
         manager_pin_locked_until =
           CASE WHEN manager_pin_failed_attempts + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
                ELSE manager_pin_locked_until END
     WHERE user_id = $1
     RETURNING manager_pin_failed_attempts AS attempts,
               manager_pin_locked_until AS locked_until`,
    [userId, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
  );

  const until = rows[0]?.locked_until ? new Date(rows[0].locked_until).getTime() : 0;
  if (until > Date.now()) {
    return {
      ok: false,
      reason: "locked",
      retryAfterSeconds: Math.ceil((until - Date.now()) / 1000),
    };
  }
  return { ok: false, reason: "invalid" };
}

export class PinNotSetError extends Error {}
export class PinWrongCurrentError extends Error {}

/**
 * เปลี่ยนรหัส — ต้องรู้รหัสเดิมเสมอ
 *
 * หลังเปลี่ยน manager_pin_updated_at เปลี่ยน → เวอร์ชันในคุกกี้เก่าไม่ตรง
 * โหมดผู้จัดการที่เปิดค้างอยู่ทุกเครื่องจึงถูกตัดทันที
 */
export async function changePin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<number> {
  const s = await loadSettings(userId);
  if (!s || !s.manager_pin_hash) throw new PinNotSetError();

  const verified = await verifyPin(userId, currentPin);
  if (!verified.ok) throw new PinWrongCurrentError(verified.reason);

  const fmt = validatePinFormat(newPin);
  if (!fmt.ok) throw new PinFormatError(fmt.reason);

  const hash = await bcrypt.hash(newPin, 10);
  const { rows } = await pool.query<{ manager_pin_updated_at: Date | string }>(
    `UPDATE pos_shop_settings
     SET manager_pin_hash = $2,
         manager_pin_updated_at = now(),
         manager_pin_failed_attempts = 0,
         manager_pin_locked_until = NULL
     WHERE user_id = $1
     RETURNING manager_pin_updated_at`,
    [userId, hash],
  );
  return epoch(rows[0].manager_pin_updated_at);
}

/** เวอร์ชันปัจจุบันของรหัส — ใช้เทียบกับคุกกี้ */
export async function currentPinVersion(userId: string): Promise<number | null> {
  const s = await loadSettings(userId);
  if (!s || !s.manager_pin_hash) return null;
  return epoch(s.manager_pin_updated_at);
}

/** บันทึกเหตุการณ์ — ห้าม log PIN หรือ hash เด็ดขาด */
export async function logManager(
  userId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO hr_audit_logs (user_id, actor, employee_id, action, detail)
     VALUES ($1, 'owner', NULL, $2, $3)`,
    [userId, action, detail ? JSON.stringify(detail) : null],
  );
}
