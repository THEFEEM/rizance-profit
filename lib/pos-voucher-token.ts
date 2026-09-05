/**
 * Gift Voucher token — 2 ชั้น (AUDIT-gift-voucher.md §3)
 *
 *   public_code  NAL26-0001   อ่านออกเสียงได้ · ไม่ลับ · ใช้ค้นหา
 *   token        rzv_XXXX…    ลับ · อยู่ใน QR/URL เท่านั้น · DB เก็บแค่ sha256
 *
 * ทำไมไม่ใช้ public_code เป็น QR: เดา sequence ได้ → ใครก็พิมพ์ NAL26-0002 ได้
 * ทำไม hash: pattern เดียวกับ employees.token_hash (0077) — หลุด DB ก็ปลอม QR ไม่ได้
 */
import { createHash, randomBytes } from "node:crypto";

export const VOUCHER_TOKEN_PREFIX = "rzv_";
/** ตัดตัวที่อ่านสับสน (0/O/1/I/L) — ถ้าต้องพิมพ์มือ 4 ตัวท้ายจะไม่พลาด */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BODY_LEN = 26; // 26 × log2(31) ≈ 129 bit

const TOKEN_RE = new RegExp(`^${VOUCHER_TOKEN_PREFIX}[${ALPHABET}]{${BODY_LEN}}$`);

export function generateVoucherToken(): string {
  const bytes = randomBytes(BODY_LEN);
  let body = "";
  for (let i = 0; i < BODY_LEN; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return VOUCHER_TOKEN_PREFIX + body;
}

export function hashVoucherToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isVoucherToken(v: string): boolean {
  return TOKEN_RE.test(v);
}

/**
 * รับได้ทั้ง token ดิบ, URL การ์ด (…/v/rzv_…), หรือข้อความที่สแกนมา
 * คืน null ถ้าไม่ใช่ voucher ของเรา — ผู้เรียกตัดสินเองว่าจะบอกอะไรผู้ใช้
 */
export function parseVoucherToken(raw: string): string | null {
  const s = raw.trim();
  if (isVoucherToken(s)) return s;
  const m = s.match(new RegExp(`${VOUCHER_TOKEN_PREFIX}[${ALPHABET}]{${BODY_LEN}}`));
  // ป้องกันเคส token ถูกต่อท้ายด้วยตัวอักษรอื่นในสตริงยาว (regex ด้านบนจับแค่ 26 ตัวพอดี)
  return m ? m[0] : null;
}

/** URL การ์ดดิจิทัล — base มาจาก env ฝั่ง server เท่านั้น */
export function voucherCardUrl(posAppBaseUrl: string, token: string): string {
  return `${posAppBaseUrl.replace(/\/+$/, "")}/v/${token}`;
}

/** public_code: PREFIX-0001 */
export function formatPublicCode(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}
