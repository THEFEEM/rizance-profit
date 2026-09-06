/**
 * Manual Code (V2.1) — pure functions · ไม่แตะ DB · มีสำเนาเดียวกันฝั่ง pos (lib/manualCode.ts) + parity test
 *
 * รูปแบบ code 2 แบบ (แยกกันเด็ดขาด — ไม่มีทางกำกวม):
 *   range   PREFIX-0042   prefix A-Z0-9 2–12 ตัว · ตัวเลข 1–8 หลัก (padding ตอนพิมพ์ · parse ตัวเลขจริง)
 *   custom  VIP-2026 / OPENING20   A-Z0-9- ยาว 3–24 · ห้ามเป็นรูป PREFIX-ตัวเลข (สงวนให้ range)
 *
 * ทำไม prefix ของ range ต้อง = code_prefix ของแคมเปญ: code ทั้งร้านต้อง resolve ได้ทางเดียว
 * (prefix → แคมเปญ → range ที่ครอบเลขนั้น) — prefix จึงต้อง unique ต่อร้านในแคมเปญที่ยังไม่ archive
 *
 * ⚠️ Manual code เดาได้ (sequence) — ไม่ใช่ secure token · ห้ามเรียกว่า secure · server ตรวจทุกอย่าง + กันซ้ำที่ DB
 */

export const MANUAL_QR_PREFIX = "rzm:";
export const MANUAL_PREFIX_RE = /^[A-Z0-9]{2,12}$/;
export const MANUAL_RANGE_CODE_RE = /^([A-Z0-9]{2,12})-(\d{1,8})$/;
export const MANUAL_CUSTOM_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/;
export const MANUAL_MAX_RANGE_SIZE = 100_000;
export const MANUAL_MIN_PADDING = 1;
export const MANUAL_MAX_PADDING = 8;

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/**
 * ทำให้ input จาก POS/สแกน เป็นรูปมาตรฐาน: ตัด rzm: · trim · ตัดช่องว่าง/ขีดแปลก ๆ · ตัวพิมพ์ใหญ่ · เลขไทย → อารบิก
 * ไม่ตัดสินว่า valid — แค่ normalize (validate ด้วย parseManualCode)
 */
export function normalizeManualCode(raw: string): string {
  let s = String(raw ?? "").trim();
  if (s.toLowerCase().startsWith(MANUAL_QR_PREFIX)) s = s.slice(MANUAL_QR_PREFIX.length);
  s = s
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/[‐-―−]/g, "-") // en/em dash · minus → hyphen
    .replace(/\s+/g, "")
    .toUpperCase();
  return s;
}

export type ParsedManualCode =
  | { kind: "range"; prefix: string; number: number; raw: string }
  | { kind: "custom"; code: string; raw: string }
  | null;

/** แยกว่าเป็น range code / custom code / ไม่ใช่ manual code เลย (null) */
export function parseManualCode(raw: string): ParsedManualCode {
  const s = normalizeManualCode(raw);
  if (!s) return null;
  const m = s.match(MANUAL_RANGE_CODE_RE);
  if (m) {
    const number = Number(m[2]);
    if (!Number.isSafeInteger(number) || number < 1) return null;
    return { kind: "range", prefix: m[1], number, raw: s };
  }
  if (isValidCustomCode(s)) return { kind: "custom", code: s, raw: s };
  return null;
}

/** SUMMER20 + 42 + padding 4 → SUMMER20-0042 (เลขยาวกว่า padding ก็ไม่ตัด: 12345 padding 4 → 12345) */
export function formatManualCode(prefix: string, number: number, padding: number): string {
  return `${prefix}-${String(number).padStart(padding, "0")}`;
}

/** จำนวน code ในช่วง — ใช้ทั้ง validate ฟอร์มและ analytics (configured codes) */
export function manualRangeSize(startNumber: number, endNumber: number): number {
  return endNumber - startNumber + 1;
}

/**
 * Custom code ต้อง: A-Z 0-9 - · ยาว 3–24 · ไม่เริ่ม/จบด้วยขีด · ไม่มีขีดติดกัน · **ไม่ใช่รูป PREFIX-ตัวเลข**
 * (NAL26-0001 เป็นรูป range → ห้ามตั้งเป็น custom แม้ยังไม่มีแคมเปญ prefix นั้น — กันชนกับ secure/range ในอนาคต)
 */
export function isValidCustomCode(code: string): boolean {
  if (!MANUAL_CUSTOM_CODE_RE.test(code)) return false;
  if (code.includes("--")) return false;
  if (MANUAL_RANGE_CODE_RE.test(code)) return false;
  return true;
}

export type ManualRangeInputCheck =
  | { ok: true; size: number; first: string; last: string }
  | { ok: false; error: string };

/** ตรวจ input ฟอร์ม range (client ชั้นแรก · server zod ซ้ำ) */
export function checkManualRangeInput(input: {
  prefix: string;
  startNumber: number;
  endNumber: number;
  padding: number;
}): ManualRangeInputCheck {
  const { prefix, startNumber, endNumber, padding } = input;
  if (!MANUAL_PREFIX_RE.test(prefix)) return { ok: false, error: "prefix ต้องเป็น A-Z 0-9 ยาว 2–12 ตัว" };
  if (!Number.isInteger(startNumber) || startNumber < 1) return { ok: false, error: "เลขเริ่มต้องเป็นจำนวนเต็ม ≥ 1" };
  if (!Number.isInteger(endNumber) || endNumber < startNumber) return { ok: false, error: "เลขสุดท้ายต้องไม่น้อยกว่าเลขเริ่ม" };
  if (!Number.isInteger(padding) || padding < MANUAL_MIN_PADDING || padding > MANUAL_MAX_PADDING) {
    return { ok: false, error: `จำนวนหลักต้องอยู่ระหว่าง ${MANUAL_MIN_PADDING}–${MANUAL_MAX_PADDING}` };
  }
  if (String(endNumber).length > MANUAL_MAX_PADDING) return { ok: false, error: "เลขสุดท้ายยาวเกิน 8 หลัก" };
  const size = manualRangeSize(startNumber, endNumber);
  if (size > MANUAL_MAX_RANGE_SIZE) return { ok: false, error: `ช่วงเดียวออกได้ไม่เกิน ${MANUAL_MAX_RANGE_SIZE.toLocaleString()} code` };
  return {
    ok: true,
    size,
    first: formatManualCode(prefix, startNumber, padding),
    last: formatManualCode(prefix, endNumber, padding),
  };
}

/** ช่วงเลขซ้อนกันไหม (inclusive) — ใช้เช็ค collision ระหว่าง range ใน prefix เดียวกัน */
export function manualRangesOverlap(
  a: { startNumber: number; endNumber: number },
  b: { startNumber: number; endNumber: number },
): boolean {
  return a.startNumber <= b.endNumber && b.startNumber <= a.endNumber;
}

/** payload ที่ใส่ใน QR ของ Manual Card — แค่ identifier · server validate ใหม่ทั้งหมด · ไม่ใช่ secure token */
export function manualQrPayload(code: string): string {
  return `${MANUAL_QR_PREFIX}${code}`;
}

/** ชื่อไฟล์ปลอดภัย: A-Z a-z 0-9 - _ เท่านั้น (ไทย/ช่องว่าง → -) · ยาวไม่เกิน 60 · ไม่มี token */
export function sanitizeFilePart(s: string, max = 60): string {
  const out = String(s ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max);
  return out || "voucher";
}
