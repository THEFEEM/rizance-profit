import { SignJWT, jwtVerify } from "jose";
import { useSecureCookies, sessionCookieDomain } from "@/lib/env";

/**
 * โหมดผู้จัดการ — คุกกี้ที่เซ็นชื่อและหมดอายุจริง (0087)
 *
 * ═══ ทำไมต้องเป็นคุกกี้ที่เซิร์ฟเวอร์เซ็น ═══════════════════════
 * ของเดิมเก็บสถานะปลดล็อกใน sessionStorage ล้วน ๆ ซึ่งฝั่ง client แก้เองได้
 * และ PIN ก็อยู่ในบันเดิล JS — เปิด DevTools ก็ผ่านได้ทันที
 *
 * ตอนนี้: PIN ตรวจที่เซิร์ฟเวอร์ → เซ็นคุกกี้ httpOnly ที่มี exp จริง
 * client อ่านไม่ได้ แก้ไม่ได้ ปลอมไม่ได้ และหมดอายุเองแน่นอน
 *
 * ═══ สิ่งที่อยู่ในคุกกี้ ═══════════════════════════════════════
 *   sub = userId · purpose = 'manager_unlock' · ver = เวอร์ชันของ PIN
 * ห้ามใส่ PIN, hash, หรือค่าตั้งค่าใด ๆ ลงไป
 *
 * `ver` = เวลาที่ตั้ง PIN ล่าสุด (epoch วินาที) — พอเปลี่ยน PIN ค่านี้เปลี่ยน
 * คุกกี้เก่าทุกใบจึงใช้ไม่ได้ทันทีโดยไม่ต้องมีตารางเก็บ session
 *
 * ⚠️ ไฟล์นี้ใช้แต่ jose (ไม่มี bcrypt / ไม่มี pg) เพื่อให้ middleware
 *    ที่รันบน edge import ได้ — เหมือนที่ lib/jwt.ts ทำไว้
 */

export const MANAGER_COOKIE = "rizance_mgr";

/** อายุโหมดผู้จัดการ — 15 นาทีตามที่ตกลงไว้ */
export const MANAGER_UNLOCK_SECONDS = 15 * 60;

const PURPOSE = "manager_unlock";

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is missing or too short. Set it in .env.local.");
  }
  return new TextEncoder().encode(secret);
}

export async function signManagerUnlock(userId: string, pinVersion: number): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, ver: pinVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MANAGER_UNLOCK_SECONDS}s`)
    .sign(secretKey());
}

export type ManagerUnlock = { userId: string; version: number; expiresAt: number };

/**
 * ตรวจคุกกี้ — คืน null ถ้าปลอม/หมดอายุ/ผิดวัตถุประสงค์
 *
 * ผู้เรียกต้องเทียบ `version` กับ PIN ปัจจุบันอีกชั้น เพื่อให้การเปลี่ยน PIN
 * ทำให้คุกกี้เก่าใช้ไม่ได้ทันที
 */
export async function verifyManagerUnlock(
  token: string | undefined,
): Promise<ManagerUnlock | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.purpose !== PURPOSE) return null;
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.ver !== "number") return null;
    if (typeof payload.exp !== "number") return null;
    return { userId: payload.sub, version: payload.ver, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.split(":")[0]!.toLowerCase();
}

function cookieDomain(host: string): string | undefined {
  const configured = sessionCookieDomain();
  if (!configured) return undefined;
  const bare = configured.replace(/^\./, "");
  const normalized = normalizeHost(host);
  return normalized === bare || normalized.endsWith("." + bare) ? configured : undefined;
}

/** แฟล็กเดียวกับคุกกี้ session เดิม — httpOnly เสมอ · Secure บน production */
function base(host: string) {
  const domain = cookieDomain(host);
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function managerCookieOptions(host: string) {
  return { ...base(host), maxAge: MANAGER_UNLOCK_SECONDS };
}

export function clearManagerCookieOptions(host: string) {
  return { ...base(host), maxAge: 0 };
}
