/**
 * ตัวตรวจ `next` / `returnTo` แบบรวมศูนย์ — **edge-safe · ไม่ import อะไรเลย**
 * (middleware และ client component ใช้ได้ · lib/oauth-state.ts เรียกต่อจากที่นี่)
 *
 * รับเฉพาะ path ภายใน origin เดียวกัน (`/…`) — ห้ามหลุดไป origin อื่นไม่ว่าจะเข้ารหัสแบบไหน
 *
 * ปฏิเสธ: https://evil.example · //evil.example · javascript:… · data:… ·
 *         /\evil.example · /%2Fevil · ค่าที่มี CR/LF/TAB (header injection)
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/home"): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  if (/[\r\n\t]/.test(raw)) return fallback;
  if (!raw.startsWith("/")) return fallback;          // absolute URL · javascript: · data:
  if (raw.startsWith("//")) return fallback;          // protocol-relative
  if (raw.startsWith("/\\") || raw.startsWith("/%2F") || raw.startsWith("/%5C")) return fallback;
  try {
    const marker = "https://return-to.invalid";
    const u = new URL(raw, marker);
    if (u.origin !== marker) return fallback;         // หลุดออกนอก origin = ไม่รับ
    const path = `${u.pathname}${u.search}${u.hash}`;
    return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}

/**
 * path ที่ต้องเปิดด้วย full navigation (ไม่ใช่ client router) — route handler ที่ตอบ redirect
 * เช่น /api/pos/handoff · client router จะยิงเป็น RSC fetch แล้วตาม redirect ไม่ได้
 */
export function requiresFullNavigation(path: string): boolean {
  return path.startsWith("/api/");
}
