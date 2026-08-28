import { createHash } from "crypto";
import type { NextRequest } from "next/server";

/** In-memory sliding-window rate limiter (per serverless instance on Vercel). */
const hits = new Map<string, number[]>();

const AUTH_LIMIT = 10; // max attempts
const AUTH_WINDOW_MS = 60_000; // per minute

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Returns seconds until the client may retry, or null if under the limit. */
function slidingWindowExceeded(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= limit) {
    const retryAfterMs = recent[0] + windowMs - now;
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
  }

  recent.push(now);
  hits.set(key, recent);
  return null;
}

/**
 * ด่าน login/register — 10 ครั้ง/นาที ต่อ IP (กัน brute-force รหัสผ่าน)
 * @param key — typically `login:1.2.3.4` or `register:1.2.3.4`
 */
export function authRateLimitExceeded(key: string): number | null {
  return slidingWindowExceeded(key, AUTH_LIMIT, AUTH_WINDOW_MS);
}

/**
 * ด่านแอปพนักงาน /e/[token] — จำกัด "ต่อ token" ไม่ใช่ต่อ IP
 *
 * ═══ บทเรียน 28 ส.ค. 2569 ═══════════════════════════════════════
 * เดิมทุก endpoint ของแอปพนักงานแชร์ bucket `hr_staff:<IP>` 10 ครั้ง/นาที
 * แต่ทั้งร้านอยู่หลัง WiFi เดียวกัน = IP เดียว — พนักงาน 3 คนเปิดแอปพร้อมกัน
 * (เปิด 1 ครั้ง = 4 requests + resync ทุกครั้งที่สลับแอปกลับมา) เกินโควตาทันที
 * เส้นที่โดน 429 แบบสุ่มคือ duty → client ตีความว่า "ไม่ใช่ผู้จัดการ" →
 * จอผู้จัดการเด้งกลับเป็นจอพนักงานทั้งจอ
 *
 * ต่อ token: token คือ identity จริงของพนักงานหนึ่งคนอยู่แล้ว (server ตรวจต่อ)
 * แต่ละคนได้โควตาของตัวเอง ไม่แย่งกันในร้าน
 * ต่อ IP ยังมีเพดานหลวม ๆ กันคน scan token มั่ว ๆ จากเครื่องเดียว
 *
 * key ใช้ sha256 ของ token — ไม่เก็บ token เต็มไว้ใน memory map
 * (แนวเดียวกับที่ห้าม log token/PIN — ของลับต้องไม่ค้างที่ไหนนอกคอลัมน์ hash)
 */
const STAFF_TOKEN_LIMIT = 60; // ต่อ token ต่อนาที — load 1 ครั้ง = 4-5 requests
const STAFF_IP_LIMIT = 600; // ต่อ IP ต่อนาที — ร้านหนึ่งมีหลายคนหลัง NAT เดียว

/**
 * token จาก path /api/public/hr/<token>/... — ดึงเองเพื่อให้ route เรียกได้
 * ก่อน await params (Next 15 params เป็น Promise) โดยไม่ต้อง reorder ทุก handler
 * token charset [A-Za-z0-9_-] จึงไม่โดน URL-encode เพี้ยน · ไม่มี = bucket "unknown"
 */
function staffTokenKey(req: NextRequest): string {
  const token = req.nextUrl.pathname.split("/")[4] || "unknown";
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

export function staffRateLimitExceeded(req: NextRequest): number | null {
  const byToken = slidingWindowExceeded(
    `hr_staff_t:${staffTokenKey(req)}`,
    STAFF_TOKEN_LIMIT,
    60_000,
  );
  const byIp = slidingWindowExceeded(`hr_staff_ip:${clientIp(req)}`, STAFF_IP_LIMIT, 60_000);
  return byToken ?? byIp;
}

/**
 * ด่านลงเวลา (clock-in/out/break) — เข้มกว่าเส้นอ่านข้อมูล แต่ยังต่อ token
 * (กดเข้างานเป็น action คนกดเองทีละครั้ง — 15/นาทีเหลือเฟือ และกันสคริปต์ยิงถี่)
 */
export function clockRateLimitExceeded(req: NextRequest): number | null {
  const byToken = slidingWindowExceeded(`hr_clock_t:${staffTokenKey(req)}`, 15, 60_000);
  const byIp = slidingWindowExceeded(`hr_clock_ip:${clientIp(req)}`, 120, 60_000);
  return byToken ?? byIp;
}
