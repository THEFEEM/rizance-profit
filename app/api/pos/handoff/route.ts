import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { isVercel } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";
import { POS_COMPAT_AUTH_ORIGIN, createHandoffToken, safePosNext } from "@/lib/pos-handoff";

/**
 * AUTH-HOTFIX-1 — handoff START (เรียกบน canonical www.rizance.com)
 *
 *   มี session www  → ออก token ใช้ครั้งเดียว → 303 ไป accept บน host ที่ POS ใช้ (rizance.app)
 *   ไม่มี session   → /login?next=/api/pos/handoff?next=<pos> (path ภายใน · ผ่าน safeNextPath)
 *                     หลังล็อกอิน middleware/LoginForm/OAuth พากลับมาที่นี่ ไม่ทิ้งไป /home
 *
 * `next` (URL ของ POS) ถูกตรวจด้วย safePosNext ตั้งแต่ตรงนี้และฝังใน token — accept ไม่รับซ้ำ
 * ห้าม cache · ห้าม log token
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

export async function GET(req: NextRequest) {
  const posNext = safePosNext(req.nextUrl.searchParams.get("next"));
  const userId = await getUserId(req);

  if (!userId) {
    const resume = new URL("/api/pos/handoff", req.url);
    resume.searchParams.set("next", posNext);
    const login = new URL("/login", req.url);
    login.searchParams.set("next", safeNextPath(`${resume.pathname}${resume.search}`, "/home"));
    return NextResponse.redirect(login, { status: 303, headers: NO_STORE });
  }

  let token: string;
  try {
    token = await createHandoffToken(userId, posNext);
  } catch (err) {
    // ออก token ไม่ได้ (ตารางยังไม่มี / DB) — ไม่ส่งผู้ใช้วนไปวนมา
    console.error("[pos-handoff] create failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json(
      { error: { message: "POS handoff unavailable", code: "handoff_unavailable" } },
      { status: 503, headers: NO_STORE },
    );
  }

  // production: accept ต้องอยู่บน host ที่ POS ยิง API (cookie host-only) · local dev: origin เดียวกัน
  const acceptOrigin = isVercel() ? POS_COMPAT_AUTH_ORIGIN : req.nextUrl.origin;
  const accept = new URL("/api/pos/handoff/accept", acceptOrigin);
  accept.searchParams.set("t", token);
  return NextResponse.redirect(accept, { status: 303, headers: NO_STORE });
}
