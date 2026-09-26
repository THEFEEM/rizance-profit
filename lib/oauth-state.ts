import { randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { safeNextPath } from "@/lib/safe-next";
import { useSecureCookies } from "@/lib/env";

/**
 * OAuth state + re-authentication proof — A-3.SEC
 *
 * ═══ ทำไมต้องมีไฟล์นี้ ═════════════════════════════════════════════
 * เดิม `/api/auth/google` สร้าง auth URL โดย **ไม่มี `state`** เลย และ
 * `/api/auth/google/callback` รับ `code` มาแลก token ทันทีโดยไม่ตรวจอะไร
 * ⇒ ใครก็ตามที่หลอกให้เบราว์เซอร์เหยื่อเปิด callback URL พร้อม `code`
 *   ของตัวเอง จะทำให้เหยื่อถูกล็อกอินเข้าบัญชีของผู้โจมตีได้ (login CSRF)
 *
 * ═══ ทำไมเลือกแบบนี้ ═══════════════════════════════════════════════
 * เลือกแบบ B ของสเปก: **nonce สุ่มทึบใน query `state` + context cookie ที่ลงลายเซ็น**
 *
 *   · `state` ที่วิ่งผ่าน Google เป็นค่าสุ่มทึบล้วน ไม่มีความหมายในตัว
 *     — มันจะไปโผล่ใน log ของผู้ให้บริการและ history ของเบราว์เซอร์
 *       จึงไม่ควรใส่ purpose/uid/returnTo ลงไปตรง ๆ
 *   · บริบทจริง (purpose · uid · returnTo · หมดอายุ) อยู่ใน **cookie httpOnly
 *     ที่ลงลายเซ็น HS256** — แก้ไม่ได้ อ่านฝั่ง client ไม่ได้
 *   · การที่ nonce ใน cookie ต้องตรงกับ `state` ที่ Google ส่งกลับ
 *     = ผูก callback เข้ากับ **เบราว์เซอร์ตัวที่เริ่ม flow** เท่านั้น
 *
 * ใช้ jose + JWT_SECRET ตัวเดิม (ไม่เพิ่ม dependency ใหม่ ไม่เพิ่ม env ใหม่)
 *
 * ⚠️ token ทุกตัวในไฟล์นี้ **จงใจไม่ใส่ `sub`** — เพื่อให้เอาไปใช้เป็น
 *    session cookie แทนกันไม่ได้ (`verifySession` อ่านเฉพาะ `sub`)
 *    userId เก็บใน claim ชื่อ `uid` แทน
 *
 * ไฟล์นี้ import `node:crypto` จึง **ไม่ edge-safe** — ห้าม import จาก middleware
 */

export const OAUTH_STATE_COOKIE = "rizance_oauth";
export const OAUTH_STATE_TTL_SECONDS = 600; // 10 นาที — พอสำหรับหน้าจอ Google

/** cookie พิสูจน์การยืนยันตัวตนสด สำหรับงานทำลายล้างใน A-3.2+ */
export const REAUTH_COOKIE = "rizance_reauth";
/** จำกัด path ให้แคบที่สุดที่ยังใช้งานได้ — ส่งเฉพาะ /api/account/* */
export const REAUTH_COOKIE_PATH = "/api/account";
export const REAUTH_TTL_SECONDS = 600; // 10 นาที

/**
 * ปลายทางหลัง reauth — A-3.SEC-5
 * ⚠️ เดิมชี้ `/settings/account` ซึ่ง **ไม่มีอยู่จริงใน app router** → ผู้ใช้เจอ 404
 *    หน้าตั้งค่าบัญชีจริงของ Rizance คือ `app/(app)/profile/page.tsx`
 */
export const REAUTH_DEFAULT_RETURN_TO = "/profile";

/** กรอบความสดของ `auth_time` จาก Google (วินาที) */
export const REAUTH_MAX_AUTH_AGE_SECONDS = 600;

export const OAUTH_PURPOSE_LOGIN = "login" as const;
export const OAUTH_PURPOSE_REAUTH = "reauth" as const;
export type OAuthPurpose = typeof OAUTH_PURPOSE_LOGIN | typeof OAUTH_PURPOSE_REAUTH;

const REAUTH_PURPOSE = "account_destructive_reauth";

export type OAuthStateClaims = {
  purpose: OAuthPurpose;
  nonce: string;
  /** ผู้ใช้ที่ล็อกอินอยู่ ณ ตอนเริ่ม flow — มีเฉพาะ purpose = reauth */
  uid?: string;
  returnTo?: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is missing or too short. Set it in .env.local.");
  }
  return new TextEncoder().encode(secret);
}

/** 256 บิตจาก CSPRNG — ห้ามใช้ Math.random() */
function randomNonce(): string {
  return randomBytes(32).toString("base64url");
}

/** เทียบแบบ constant-time · ความยาวต่างกัน = ไม่ตรง (เทียบความยาวก่อนกัน throw) */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * ตรวจปลายทางหลังล็อกอิน — รับเฉพาะ path ภายในแอปเท่านั้น
 *
 * ปฏิเสธ: https://evil.example · //evil.example · javascript:… · data:… ·
 *         /\evil.example · ค่าที่มี CR/LF (header injection)
 */
export function safeReturnTo(raw: string | null | undefined, fallback = "/home"): string {
  // ตรรกะเดิมทุกบรรทัด ย้ายไป lib/safe-next.ts (edge-safe) ให้ middleware/LoginForm ใช้ตัวเดียวกัน
  return safeNextPath(raw, fallback);
}

function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    // Lax จำเป็น: callback กลับมาจาก Google เป็น top-level GET ข้ามไซต์
    // ถ้าใช้ Strict เบราว์เซอร์จะไม่ส่ง cookie มาด้วย → flow พังทุกครั้ง
    sameSite: "lax" as const,
    path: "/api/auth/google",
    maxAge,
  };
}

/**
 * เริ่ม OAuth flow — คืน nonce ที่จะใส่ใน query `state` และ cookie บริบทที่ลงลายเซ็น
 * `state` ที่ส่งออกไปเป็นค่าสุ่มทึบ ไม่มีความลับและไม่มีข้อมูลผู้ใช้อยู่ข้างใน
 */
export async function createOAuthState(input: {
  purpose: OAuthPurpose;
  uid?: string;
  returnTo?: string;
}): Promise<{ state: string; cookieName: string; cookieValue: string; cookieOptions: ReturnType<typeof stateCookieOptions> }> {
  const nonce = randomNonce();
  const claims: Record<string, unknown> = { purpose: input.purpose, nonce };
  if (input.uid) claims.uid = input.uid;
  if (input.returnTo) claims.returnTo = safeReturnTo(input.returnTo);

  const cookieValue = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .sign(secretKey());

  return {
    state: nonce,
    cookieName: OAUTH_STATE_COOKIE,
    cookieValue,
    cookieOptions: stateCookieOptions(OAUTH_STATE_TTL_SECONDS),
  };
}

/**
 * ตรวจ callback — ต้องผ่านครบทุกข้อ ไม่งั้นคืน null
 *   1. มี cookie บริบท (ถ้าไม่มี = ไม่ได้เริ่มจากเว็บเรา)
 *   2. ลายเซ็นถูกและยังไม่หมดอายุ (jose ตรวจ exp ให้)
 *   3. มี state ใน query
 *   4. state ตรงกับ nonce ใน cookie แบบ constant-time
 *   5. purpose ตรงกับที่คาด
 *
 * ผู้เรียก **ต้องล้าง cookie เสมอ** ไม่ว่าผลจะเป็นอย่างไร (ใช้ครั้งเดียว)
 */
export async function verifyOAuthState(
  cookieValue: string | undefined,
  stateParam: string | null | undefined,
): Promise<OAuthStateClaims | null> {
  if (!cookieValue || typeof stateParam !== "string" || stateParam === "") return null;
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(cookieValue, secretKey()));
  } catch {
    return null;                                  // ลายเซ็นผิด · หมดอายุ · ถูกแก้
  }
  const purpose = payload.purpose;
  const nonce = payload.nonce;
  if (purpose !== OAUTH_PURPOSE_LOGIN && purpose !== OAUTH_PURPOSE_REAUTH) return null;
  if (typeof nonce !== "string" || !safeEqual(nonce, stateParam)) return null;

  return {
    purpose,
    nonce,
    uid: typeof payload.uid === "string" ? payload.uid : undefined,
    returnTo: typeof payload.returnTo === "string" ? safeReturnTo(payload.returnTo) : undefined,
  };
}

/** ล้าง cookie บริบท — ต้องเรียกทุกเส้นทางที่ออกจาก callback (สำเร็จและล้มเหลว) */
export function clearOAuthStateCookie() {
  return { name: OAUTH_STATE_COOKIE, value: "", options: stateCookieOptions(0) };
}

// ══════════════════════════════════════════════════════════════════════
//  หลักฐานการยืนยันตัวตนสด (reauth proof)
// ══════════════════════════════════════════════════════════════════════
//
//  ออกให้ **หลังจาก** พิสูจน์แล้วเท่านั้นว่าบัญชี Google ที่เพิ่งยืนยัน
//  คือบัญชีเดียวกับผู้ใช้ Rizance ที่ล็อกอินอยู่ (ดู /api/auth/google/callback)
//
//  ⚠️ session 7 วันตามปกติ **ห้าม** ใช้เป็นหลักฐานความสด — นั่นคือเหตุผลที่
//     ต้องมี cookie แยกตัวนี้ที่อายุ 10 นาที
//
//  A-3.2+ จะเป็นผู้บริโภค: ตรวจด้วย verifyReauthProof(value, user.id)

function reauthCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    // Lax: cookie ถูก set บน response ของ redirect ที่กลับมาจาก Google
    sameSite: "lax" as const,
    path: REAUTH_COOKIE_PATH,
    maxAge,
  };
}

export async function issueReauthProof(userId: string) {
  const value = await new SignJWT({ purpose: REAUTH_PURPOSE, uid: userId, nonce: randomNonce() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REAUTH_TTL_SECONDS}s`)
    .sign(secretKey());
  return { name: REAUTH_COOKIE, value, options: reauthCookieOptions(REAUTH_TTL_SECONDS) };
}

/** ใช้โดย A-3.2+ ก่อนทำงานทำลายล้าง — ต้องผ่านทั้ง purpose · uid · exp */
export async function verifyReauthProof(
  cookieValue: string | undefined,
  expectedUserId: string,
): Promise<boolean> {
  if (!cookieValue || !expectedUserId) return false;
  try {
    const { payload } = await jwtVerify(cookieValue, secretKey());
    if (payload.purpose !== REAUTH_PURPOSE) return false;
    return typeof payload.uid === "string" && safeEqual(payload.uid, expectedUserId);
  } catch {
    return false;
  }
}

export function clearReauthProofCookie() {
  return { name: REAUTH_COOKIE, value: "", options: reauthCookieOptions(0) };
}
