// server-only โดยธรรมชาติ (node:crypto) — ห้าม import จาก client component / middleware (edge)
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { isVercel } from "@/lib/env";

/**
 * AUTH-HOTFIX-1 — POS SSO handoff (ชั่วคราว จนกว่าจะย้ายเป็น pos.rizance.com + cookie .rizance.com)
 *
 * ปัญหา: session อยู่บน www.rizance.com แต่ POS (pos.rizance.app) เรียก API ที่ rizance.app
 *        cookie host-only ข้าม registrable domain ไม่ได้
 *
 * flow:  POS 401 → www/api/pos/handoff (ต้องมี session www) → ออก token ใช้ครั้งเดียว 60 วิ
 *        → rizance.app/api/pos/handoff/accept?t=… → verify + consume (atomic ใน DB)
 *        → ตั้ง rizance_session บน rizance.app ด้วย sessionCookieOptions ชุดเดิม → กลับ POS
 *
 * ความปลอดภัย
 *   · เซ็นด้วย **key แยก** (HKDF-ish จาก JWT_SECRET) — token นี้ใส่เป็น rizance_session ไม่ได้
 *     (verifySession ใช้ key อื่น จึงตรวจลายเซ็นไม่ผ่าน) แม้ token จะโผล่ใน URL/log
 *   · aud + iss ถูกบังคับตรวจ · exp ≤ 60 วิ · jti สุ่ม 256 บิต
 *   · single-use จริง: jti (hash) ถูกบันทึกตอนออก และ consume แบบ atomic (UPDATE … WHERE consumed_at IS NULL)
 *     ไม่ใช้ in-memory — serverless instance ไม่แชร์กัน
 *   · ปลายทาง POS ถูกตรวจตอนออก token แล้ว **ฝังไว้ใน token** — accept ไม่รับ next จาก query
 *   · ไม่เก็บ token ดิบใน DB · log ได้แค่ reason + jti hash 8 ตัวแรก
 */

export const POS_HANDOFF_AUD = "pos-handoff";
export const POS_HANDOFF_ISS = "rizance-profit";
export const POS_HANDOFF_TTL_SECONDS = 60;

/** host ที่ POS ใช้เป็น API ตอนนี้ — accept ต้องตั้ง cookie บน host นี้ (ชั่วคราว) */
export const POS_COMPAT_AUTH_ORIGIN = "https://rizance.app";

/** origin ของ POS ที่อนุญาตให้ redirect กลับ — production ล็อกตายค่าเดียว */
const POS_ALLOWED_ORIGINS_PROD = ["https://pos.rizance.app"] as const;
export const POS_HANDOFF_DEFAULT_NEXT = "https://pos.rizance.app/";

export type HandoffReason =
  | "ok"
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "bad_audience"
  | "bad_issuer"
  | "bad_claims"
  | "consumed_or_unknown"
  | "user_not_found"
  | "store_error";

// ── key แยกจาก session ──────────────────────────────────────────────────
function handoffKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is missing or too short.");
  }
  // domain-separated derivation — คนละ key กับ TextEncoder(JWT_SECRET) ที่ session ใช้
  return new Uint8Array(createHash("sha256").update(`${secret}\u0000${POS_HANDOFF_AUD}`).digest());
}

export function hashJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

/** สำหรับ log — ไม่เปิดเผย jti จริง */
export function jtiLogId(jtiHash: string): string {
  return jtiHash.slice(0, 8);
}

// ── ปลายทาง POS ─────────────────────────────────────────────────────────
function allowedPosOrigins(): readonly string[] {
  if (isVercel()) return POS_ALLOWED_ORIGINS_PROD;
  // local dev: POS รันที่ localhost:3001 (ค่าใน getPosAppOrigin) — ไม่มีผลบน Vercel
  const dev = process.env.POS_APP_ORIGIN?.trim() || "http://localhost:3001";
  return [...POS_ALLOWED_ORIGINS_PROD, dev];
}

/**
 * รับเฉพาะ URL เต็มที่ origin ตรงกับ allowlist **แบบเทียบ origin เป๊ะ** (ไม่ใช่ startsWith)
 * ปฏิเสธ: host อื่น · lookalike (pos.rizance.app.evil) · user@host · //host · javascript: · data: ·
 *         ค่าที่มี CR/LF · path/query ที่ decode ไม่ได้ · hash ถูกตัดทิ้ง
 */
export function safePosNext(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "" || raw.length > 2048) return POS_HANDOFF_DEFAULT_NEXT;
  if (/[\r\n\t\0]/.test(raw)) return POS_HANDOFF_DEFAULT_NEXT;
  if (raw.startsWith("//") || raw.startsWith("/")) return POS_HANDOFF_DEFAULT_NEXT; // ต้องเป็น absolute
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return POS_HANDOFF_DEFAULT_NEXT;
  }
  if (u.username || u.password) return POS_HANDOFF_DEFAULT_NEXT;
  if (!allowedPosOrigins().includes(u.origin)) return POS_HANDOFF_DEFAULT_NEXT;
  return `${u.origin}${u.pathname}${u.search}`;
}

// ── storage (single-use) ────────────────────────────────────────────────
export type HandoffStore = {
  /** บันทึก jti ตอนออก token */
  create(jtiHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** consume แบบ atomic — true เฉพาะครั้งแรกและยังไม่หมดอายุและเป็น user เดียวกัน */
  consume(jtiHash: string, userId: string): Promise<boolean>;
};

const pgStore: HandoffStore = {
  async create(jtiHash, userId, expiresAt) {
    const { pool } = await import("@/lib/db");
    await pool.query(
      `INSERT INTO pos_handoff_tokens (jti_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [jtiHash, userId, expiresAt],
    );
    // เก็บกวาดของเก่าแบบถูก ๆ (ตารางควรว่างเกือบตลอด)
    void pool
      .query(`DELETE FROM pos_handoff_tokens WHERE expires_at < now() - interval '1 hour'`)
      .catch(() => {});
  },
  async consume(jtiHash, userId) {
    const { pool } = await import("@/lib/db");
    const res = await pool.query(
      `UPDATE pos_handoff_tokens
          SET consumed_at = now()
        WHERE jti_hash = $1
          AND user_id = $2
          AND consumed_at IS NULL
          AND expires_at > now()`,
      [jtiHash, userId],
    );
    return res.rowCount === 1;
  },
};

let store: HandoffStore = pgStore;

/** เทสเท่านั้น — production ห้ามสลับ store */
export function setHandoffStoreForTests(s: HandoffStore | null): void {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new Error("setHandoffStoreForTests is not allowed in production");
  }
  store = s ?? pgStore;
}

// ── token ───────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JTI_RE = /^[0-9a-f]{64}$/;

export type HandoffClaims = { userId: string; jti: string; next: string };

/** ออก token + บันทึก jti (ถ้าบันทึกไม่ได้ → ไม่ออก token) */
export async function createHandoffToken(userId: string, rawNext: string | null | undefined): Promise<string> {
  const next = safePosNext(rawNext);
  const jti = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + POS_HANDOFF_TTL_SECONDS) * 1000);
  await store.create(hashJti(jti), userId, expiresAt);
  return new SignJWT({ nxt: next })
    .setProtectedHeader({ alg: "HS256", typ: "pos-handoff+jwt" })
    .setSubject(userId)
    .setJti(jti)
    .setAudience(POS_HANDOFF_AUD)
    .setIssuer(POS_HANDOFF_ISS)
    .setIssuedAt(now)
    .setExpirationTime(now + POS_HANDOFF_TTL_SECONDS)
    .sign(handoffKey());
}

/** ตรวจลายเซ็น/exp/aud/iss/claims — **ยังไม่ consume** */
export async function verifyHandoffToken(
  token: string | null | undefined,
): Promise<{ ok: true; claims: HandoffClaims } | { ok: false; reason: HandoffReason }> {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  if (token.length > 4096 || token.split(".").length !== 3) return { ok: false, reason: "malformed" };
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, handoffKey(), {
      algorithms: ["HS256"],
      audience: POS_HANDOFF_AUD,
      issuer: POS_HANDOFF_ISS,
      clockTolerance: 0,
      maxTokenAge: `${POS_HANDOFF_TTL_SECONDS}s`,
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      if (err.claim === "aud") return { ok: false, reason: "bad_audience" };
      if (err.claim === "iss") return { ok: false, reason: "bad_issuer" };
      if (err.claim === "iat") return { ok: false, reason: "expired" };
      return { ok: false, reason: "bad_claims" };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) return { ok: false, reason: "bad_signature" };
    return { ok: false, reason: "malformed" };
  }
  const userId = payload.sub;
  const jti = payload.jti;
  const next = payload.nxt;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return { ok: false, reason: "bad_claims" };
  if (typeof jti !== "string" || !JTI_RE.test(jti)) return { ok: false, reason: "bad_claims" };
  // ปลายทางต้องผ่านตัวตรวจเดิมและ **เท่ากับค่าเดิมเป๊ะ** (กัน claim ถูกดัดแปลงในทางที่ safePosNext ยังยอม)
  if (typeof next !== "string" || safePosNext(next) !== next) return { ok: false, reason: "bad_claims" };
  return { ok: true, claims: { userId, jti, next } };
}

/** consume ครั้งเดียว — true ครั้งแรกเท่านั้น */
export async function consumeHandoff(claims: HandoffClaims): Promise<{ ok: true } | { ok: false; reason: HandoffReason }> {
  try {
    const ok = await store.consume(hashJti(claims.jti), claims.userId);
    return ok ? { ok: true } : { ok: false, reason: "consumed_or_unknown" };
  } catch {
    // ตารางยังไม่มี / DB ล่ม → fail-closed
    return { ok: false, reason: "store_error" };
  }
}
