import { OAuth2Client } from "google-auth-library";

/** True when all Google OAuth env vars are configured (API routes). */
export function isGoogleAuthEnabled(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

/** True when Google sign-in button should be shown (UI only needs client ID). */
export function isGoogleLoginUiEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID;
}

/**
 * A-3.SEC-4 — อีเมลจาก Google ใช้เป็น "หลักฐานความเป็นเจ้าของอีเมล" ได้ก็ต่อเมื่อ
 * Google ยืนยันแล้วเท่านั้น
 *
 * ═══ ทำไมจึงสำคัญ ════════════════════════════════════════════════
 * callback เดิมผูก/สร้างบัญชีจาก `payload.email` โดยดูแค่ว่า "มีค่า"
 * แต่ ID token ของ Google มี `email_verified` แยกต่างหาก และเป็น false ได้จริง
 * (เช่น บัญชี Google Workspace ที่แอดมินสร้างให้ด้วยโดเมนที่ยังไม่ยืนยัน)
 * ⇒ ถ้าใครสร้างบัญชี Google ที่อ้างอีเมลของเหยื่อได้โดยไม่ต้องยืนยัน
 *   เขาจะกด "เข้าสู่ระบบด้วย Google" แล้วถูก **ผูกเข้ากับบัญชี Rizance ของเหยื่อ**
 *
 * ═══ ขอบเขต ═════════════════════════════════════════════════════
 * ใช้เฉพาะเส้นทางที่ "อีเมลเป็นตัวผูกตัวตน" — คือการ link เข้าบัญชีเดิม
 * และการสร้างบัญชีใหม่ · **ไม่แตะ** การจับคู่ด้วย `google_id` ซึ่งปลอดภัยอยู่แล้ว
 * เพราะ google_id ถูกผูกไว้ตั้งแต่ตอนที่อีเมลยังผ่านการตรวจ (หรือตอนสมัคร)
 *
 * ═══ ตีความค่า ══════════════════════════════════════════════════
 * รับเฉพาะ boolean `true` เท่านั้น (fail-closed) — `"true"` ที่เป็นสตริง ·
 * `undefined` · `null` · `false` ถือว่า **ไม่ยืนยัน** ทั้งหมด
 * google-auth-library ประกาศ `email_verified?: boolean` และ Google ส่ง
 * JSON boolean จริง การเข้มจึงไม่ทำให้ผู้ใช้ปกติพัง
 */
export type GoogleEmailBinding =
  | { ok: true; email: string }
  | { ok: false; reason: "no_email" | "email_unverified" };

export function resolveVerifiedGoogleEmail(payload: {
  email?: string | null;
  email_verified?: unknown;
}): GoogleEmailBinding {
  const raw = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!raw) return { ok: false, reason: "no_email" };
  if (payload.email_verified !== true) return { ok: false, reason: "email_unverified" };
  return { ok: true, email: raw };
}

/**
 * A-3.SEC-5 — การตัดสินใจเดียวที่ควบคุมว่าจะออก reauth proof หรือไม่
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะบทเรียนจาก M6: ชุดเทสเดิม 78 ข้อ
 * ตรวจ "ลำดับในซอร์ส" ด้วย indexOf ซึ่ง**พิสูจน์การตัดสินใจจริงไม่ได้เลย**
 * ตอนนี้เทสเรียกฟังก์ชันนี้ตรง ๆ และ route ก็เรียกตัวเดียวกัน
 *
 * ⚠️ `sub` ใน ID token เป็นตัวชี้ขาดตัวตนของ Google — ไม่ใช่สิ่งที่ผู้ใช้เลือกบนหน้าจอ
 *    และ **ไม่ใช่อีเมล** · ห้ามใช้อีเมลตรงกันแทนการเทียบ google_id เด็ดขาด
 *    (ผู้ใช้ auth_provider='both' ก็ต้องเทียบ google_id เหมือนกัน)
 */
export type GoogleReauthDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "no_current_user" | "state_user_mismatch" | "google_not_linked" | "google_user_mismatch";
    };

export function authorizeGoogleReauth(input: {
  /** uid ที่ฝังไว้ใน state cookie ที่ลงลายเซ็น ตอนเริ่ม flow */
  stateUserId: string | null | undefined;
  /** ผู้ใช้ที่ล็อกอินอยู่จริง อ่านจาก DB ณ ตอน callback */
  currentUserId: string | null | undefined;
  /** id ของผู้ใช้ Rizance ที่ผูกกับ google_id = payload.sub (null ถ้าไม่มีใครผูก) */
  googleLinkedUserId: string | null | undefined;
}): GoogleReauthDecision {
  const { stateUserId, currentUserId, googleLinkedUserId } = input;
  if (!currentUserId) return { ok: false, reason: "no_current_user" };
  if (!stateUserId || stateUserId !== currentUserId) {
    return { ok: false, reason: "state_user_mismatch" };
  }
  if (!googleLinkedUserId) return { ok: false, reason: "google_not_linked" };
  if (googleLinkedUserId !== currentUserId) {
    return { ok: false, reason: "google_user_mismatch" };
  }
  return { ok: true };
}

export function createGoogleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured");
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}
