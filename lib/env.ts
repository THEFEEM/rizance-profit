/** True when running on Vercel (production or preview). */
export function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * Canonical origin ของ Rizance Profit — ต้องเป็น www เพราะ apex ถูก Vercel 308 มา www
 * (ถ้า default เป็น apex แล้ว env ไม่ได้ตั้ง canonicalization จะวน apex↔www)
 */
export const DEFAULT_APP_URL = "https://www.rizance.com";

/**
 * Host ที่ **ไม่ใช่** canonical แต่ยังชี้มาที่ deployment นี้ — ทุก request บน host เหล่านี้
 * ต้อง 308 ไป canonical โดยคง path + query
 *
 *   · rizance.app            — เคยเสิร์ฟแอปเป็น origin ที่สอง ทำให้ cookie (host-only)
 *                              แยกกันคนละใบ และ Google callback เคยลงที่นี่ → TWA reopen
 *                              บน www ไม่เห็น session (root cause ที่ยืนยันบนเครื่องจริง)
 *   · rizance-profit.vercel.app — host เดิมก่อนมีโดเมน
 *
 * ⚠️ เป็น allowlist แบบตรงตัว **โดยตั้งใจ** ไม่ใช่ "host ใดก็ได้ที่ไม่ใช่ canonical":
 *   · pos.rizance.app และ subdomain อื่นต้องไม่โดน
 *   · localhost / preview URL ต้องไม่โดน
 *   · ถ้า env ผิด (canonical ชี้ host ที่ infra redirect ต่อ) จะไม่กลายเป็น redirect loop
 */
export const NON_CANONICAL_HOSTS: readonly string[] = ["rizance.app", "rizance-profit.vercel.app"];

/** hostname ของ canonical origin (ตัวพิมพ์เล็ก ไม่มี port) */
export function getCanonicalHost(): string {
  return new URL(getAppUrl()).hostname.toLowerCase();
}

/**
 * ถ้า `host` ของ request เป็น host ที่ต้อง canonicalize → คืน URL ปลายทางบน canonical origin
 * (path + query เดิม) · ไม่งั้นคืน null
 *
 * ความปลอดภัย: `host` ใช้ **เทียบกับ allowlist เท่านั้น** — ปลายทางสร้างจาก getAppUrl()
 * (config ที่เราคุม) ไม่เคยเอาค่าจาก Host / X-Forwarded-Host มาประกอบ URL → ไม่มี open redirect
 */
export function canonicalRedirectTarget(
  host: string | null | undefined,
  pathname: string,
  search: string,
): string | null {
  if (!host) return null;
  const h = host.split(":")[0]!.toLowerCase();
  if (h === getCanonicalHost()) return null;          // อยู่ที่ถูกแล้ว — กัน loop เป็นด่านแรก
  if (!NON_CANONICAL_HOSTS.includes(h)) return null;  // ไม่ใช่ host ที่เรารู้จัก → ไม่แตะ
  return `${getAppUrl().replace(/\/+$/, "")}${pathname}${search}`;
}

/** True on Vercel production deployments (not preview, not local). */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/** Public app origin used for canonical URLs and old-host redirects. */
export function getAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return value || DEFAULT_APP_URL;
}

/**
 * Session cookies must be `Secure` on any HTTPS host (Vercel prod + preview).
 * Local `next dev` is plain HTTP, so Secure is off there.
 */
export function useSecureCookies(): boolean {
  return isVercel();
}

/** Cross-subdomain session cookie (e.g. `.rizance.com`). Unset in local dev. */
export function sessionCookieDomain(): string | undefined {
  return process.env.SESSION_COOKIE_DOMAIN || undefined;
}

/** POS web app origin for CORS on /api/pos/* (e.g. https://pos.rizance.com). */
export function getPosAppOrigin(): string {
  return process.env.POS_APP_ORIGIN?.trim() || "http://localhost:3001";
}

/** Public POS app URL for dashboard links (NEXT_PUBLIC_POS_APP_URL). */
export function getPublicPosAppUrl(): string {
  return process.env.NEXT_PUBLIC_POS_APP_URL?.trim() || "http://localhost:3001";
}
