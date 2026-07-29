/** Shared pg SSL config + production guard for migrate/test scripts (mirrors lib/pg-config.ts). */
export function needsPgSsl(connectionString) {
  return (
    /sslmode=require/i.test(connectionString) ||
    /\b(pooler\.supabase\.com|neon\.tech|supabase\.co|amazonaws\.com)\b/i.test(connectionString)
  );
}

/**
 * ─────────────────────────────────────────────────────────────────
 *  PRODUCTION GUARD — ด่านเดียวที่ทุกสคริปต์ผ่าน
 * ─────────────────────────────────────────────────────────────────
 * ที่มา (29 ก.ค. 69): สคริปต์ e2e รันใส่ DB production → ออเดอร์เทสต์ 66 รายการ
 * และ pos_order_counters หลุด (6 vs 69) → เลขออเดอร์ชนกัน → ร้านขายไม่ได้ทั้งวัน
 *
 * ตอนนี้สคริปต์ที่ต่อ DB ผ่าน pgClientOptions() จะถูกบล็อกถ้าปลายทางเป็น prod
 *
 * ถ้าตั้งใจจะรันใส่ prod จริงๆ (backfill/migration) → ตั้ง ALLOW_PROD_DB=1
 *   PowerShell:  $env:ALLOW_PROD_DB=1; node scripts/backfill-xxx.mjs
 *   bash:        ALLOW_PROD_DB=1 node scripts/backfill-xxx.mjs
 *
 * เพิ่ม/เปลี่ยน DB ที่ถือว่าเป็น prod → env PROD_DB_REFS (คั่นด้วย comma)
 */

/** project ref / host ที่ถือว่าเป็น production (override ด้วย env PROD_DB_REFS) */
const DEFAULT_PROD_REFS = ["jxjprjnqgoqstnfjxovn"];

function prodRefs() {
  const raw = process.env.PROD_DB_REFS?.trim();
  if (!raw) return DEFAULT_PROD_REFS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isProductionDb(connectionString) {
  if (!connectionString) return false;
  return prodRefs().some((ref) => connectionString.includes(ref));
}

/** ตัดรหัสผ่านออกก่อน log */
function redact(connectionString) {
  try {
    const u = new URL(String(connectionString).replace(/^postgresql:/, "postgres:"));
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(อ่าน connection string ไม่ได้)";
  }
}

export class ProductionDbBlockedError extends Error {
  constructor(connectionString) {
    super(
      [
        "",
        "🛑 หยุด: สคริปต์นี้กำลังจะต่อ DATABASE ของ PRODUCTION",
        `   ปลายทาง: ${redact(connectionString)}`,
        "",
        "   เคยเกิดแล้ว 29 ก.ค. 69: e2e ยิงใส่ prod → ออเดอร์เทสต์ 66 รายการ",
        "   + counter หลุด → เลขออเดอร์ชนกัน → ร้านขายไม่ได้ทั้งวัน",
        "",
        "   ที่ถูก: ชี้ DATABASE_URL ไป dev DB ก่อนรัน",
        "   ถ้าตั้งใจจริง (backfill/migration): ตั้ง ALLOW_PROD_DB=1",
        "",
      ].join("\n"),
    );
    this.name = "ProductionDbBlockedError";
  }
}

/**
 * บล็อกถ้าปลายทางเป็น prod — เรียกตรงได้ถ้าสคริปต์ต่อ DB ด้วยวิธีอื่น
 * @param {string} connectionString
 * @param {{ allowProduction?: boolean }} [opts]
 */
export function assertNotProductionDb(connectionString, opts = {}) {
  const allowed = opts.allowProduction === true || process.env.ALLOW_PROD_DB === "1";
  if (allowed) {
    if (isProductionDb(connectionString)) {
      console.warn(`⚠️  ALLOW_PROD_DB=1 — กำลังเขียนลง PRODUCTION (${redact(connectionString)})`);
    }
    return;
  }
  if (isProductionDb(connectionString)) {
    throw new ProductionDbBlockedError(connectionString);
  }
}

/**
 * @param {string} connectionString
 * @param {{ allowProduction?: boolean }} [opts] — migration/backfill ที่ตั้งใจ ส่ง true ได้
 */
export function pgClientOptions(connectionString, opts = {}) {
  assertNotProductionDb(connectionString, opts);

  if (!needsPgSsl(connectionString)) {
    return { connectionString };
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  const cleaned = url.toString().replace(/^postgres:/, "postgresql:");
  return { connectionString: cleaned, ssl: { rejectUnauthorized: false } };
}
