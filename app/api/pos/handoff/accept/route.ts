import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestHostname, sessionCookieOptions, signSession } from "@/lib/jwt";
import {
  POS_HANDOFF_DEFAULT_NEXT,
  consumeHandoff,
  hashJti,
  jtiLogId,
  verifyHandoffToken,
  type HandoffReason,
} from "@/lib/pos-handoff";

/**
 * AUTH-HOTFIX-1 — handoff ACCEPT (ต้องเรียกบน rizance.app = host ที่ POS ยิง API)
 *
 * ลำดับ: verify (ลายเซ็น·exp·aud·iss·claims) → user ยังอยู่ → consume atomic ครั้งเดียว
 *        → ตั้ง rizance_session ด้วย sessionCookieOptions ชุดเดิม (host-only บน host นี้) → 303 ไป POS
 *
 * ล้มเหลว → ตอบ 401 เป็นหน้าเรียบ ๆ **ไม่ redirect** — กันลูป POS↔www ถ้าพังถาวร (เช่นตารางยังไม่มี)
 * /api/pos/* ไม่ถูก canonical-redirect โดย middleware อยู่แล้ว (บล็อก CORS return ก่อน) — ไม่ต้องแก้ middleware
 * ไม่ log token · log ได้แค่ reason + jti hash 8 ตัวแรก
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

function failed(reason: HandoffReason, jtiHash?: string): NextResponse {
  console.warn(`[pos-handoff] accept rejected reason=${reason}${jtiHash ? ` jti=${jtiLogId(jtiHash)}` : ""}`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rizance POS</title>
<body style="font-family:system-ui;background:#0e1525;color:#e8edf5;display:grid;place-items:center;min-height:100dvh;margin:0">
<div style="text-align:center;padding:24px;max-width:360px">
<p style="font-size:18px;font-weight:600;margin:0 0 8px">เข้าสู่ระบบ POS ไม่สำเร็จ</p>
<p style="color:#9aa6b8;margin:0 0 20px">ลิงก์หมดอายุหรือถูกใช้ไปแล้ว (${reason})</p>
<a href="${POS_HANDOFF_DEFAULT_NEXT}" style="display:inline-block;background:#4ade9e;color:#06231a;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">กลับไป POS</a>
</div></body>`;
  return new NextResponse(html, {
    status: 401,
    headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const verified = await verifyHandoffToken(req.nextUrl.searchParams.get("t"));
  if (!verified.ok) return failed(verified.reason);
  const { claims } = verified;
  const jtiHash = hashJti(claims.jti);

  // consume ก่อนตั้ง cookie — ถ้าแพ้ race ก็ไม่ได้ session
  // "user ยังอยู่" ถูกบังคับโดยตาราง: FK user_id → users ON DELETE CASCADE + UPDATE … WHERE user_id = $2
  // (ผู้ใช้ถูกลบ = แถวหาย = consume ล้มเหลว) — ไม่ต้อง query users แยกให้เกิดช่อง TOCTOU
  const consumed = await consumeHandoff(claims);
  if (!consumed.ok) return failed(consumed.reason, jtiHash);

  const token = await signSession(claims.userId);
  const res = NextResponse.redirect(claims.next, { status: 303, headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(requestHostname(req)));
  return res;
}
