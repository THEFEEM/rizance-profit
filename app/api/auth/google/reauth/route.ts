import { NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient, isGoogleAuthEnabled } from "@/lib/google-oauth";
import { getCurrentUser } from "@/lib/session";
import {
  createOAuthState,
  OAUTH_PURPOSE_REAUTH,
  REAUTH_DEFAULT_RETURN_TO,
  safeReturnTo,
} from "@/lib/oauth-state";

/**
 * A-3.SEC · SEC-3 — เริ่มการยืนยันตัวตนสดด้วย Google
 *
 * ใช้ callback ตัวเดียวกับการล็อกอิน (`GOOGLE_REDIRECT_URI` มีค่าเดียว
 * และต้องตรงกับที่ลงทะเบียนไว้กับ Google) — แยกความตั้งใจด้วย `purpose`
 * ที่อยู่ใน **cookie บริบทที่ลงลายเซ็น** ไม่ใช่ใน query ที่ client แก้ได้
 *
 * ⚠️ เฟสนี้สร้าง primitive เท่านั้น — ยังไม่มีใครเรียกใช้
 *    Account Deletion (A-3.2+) จะเป็นผู้บริโภค
 */
export async function GET(req: NextRequest) {
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: { message: "Google login is not configured" } }, { status: 404 });
  }

  // ต้องยืนยันตัวตนจาก DB เสมอ — JWT อย่างเดียวพิสูจน์ไม่ได้ว่าแถวยังอยู่
  // และ userId ต้องมาจาก session เท่านั้น ห้ามรับจาก body/query/header
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }
  // `User` (types/index.ts:51-61) ไม่ expose google_id — ใช้ authProvider แทน
  if (user.authProvider === "email") {
    // ผู้ใช้ที่ไม่ได้ผูก Google ต้องใช้รหัสผ่านยืนยันแทน (ดู §8 ของสเปก)
    return NextResponse.json(
      { error: { code: "google_not_linked", message: "บัญชีนี้ไม่ได้ผูกกับ Google" } },
      { status: 409 },
    );
  }

  try {
    const client = createGoogleOAuthClient();
    const oauth = await createOAuthState({
      purpose: OAUTH_PURPOSE_REAUTH,
      uid: user.id,
      returnTo: safeReturnTo(req.nextUrl.searchParams.get("returnTo"), REAUTH_DEFAULT_RETURN_TO),
    });

    // ═══ A-3.SEC-5 · ทำไมถึงไม่มี login_hint แล้ว ════════════════════
    // เดิมส่ง `login_hint: user.email` — Google ใช้ค่านี้เลือกบัญชีให้เงียบ ๆ
    // ทำให้ตอนทดสอบ M6 ผู้ใช้กดเลือกบัญชี B บนหน้าจอ แต่ Google กลับยืนยัน
    // ตัวตนเป็น A แล้วส่ง sub ของ A กลับมา ⇒ callback เห็นว่า "ตรงกัน" จริง ๆ
    // และออก proof ให้ ทั้งที่คนทดสอบตั้งใจใช้อีกบัญชี
    //
    // การเอา login_hint ออกทำให้ `prompt=select_account` แสดงตัวเลือกจริง
    // และสิ่งที่ผู้ใช้เลือกจะสะท้อนใน `sub` ที่ callback ได้รับ
    //
    // ⚠️ callback ไม่ได้ถูกผ่อนปรนแม้แต่น้อย — `sub` ยังเป็นตัวชี้ขาดเสมอ
    let url = client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      state: oauth.state,
    });
    // max_age=0 (OIDC) ขอให้ Google ยืนยันตัวตนใหม่และส่ง auth_time กลับมา
    // google-auth-library ไม่มี option นี้ใน type จึงต่อท้าย URL เอง
    // ⚠️ Google ไม่รับประกันว่าจะบังคับกรอกรหัสผ่านใหม่ — ดู §13 ของรายงาน
    url += "&max_age=0";

    const res = NextResponse.redirect(url);
    res.cookies.set(oauth.cookieName, oauth.cookieValue, oauth.cookieOptions);
    return res;
  } catch (err) {
    console.error("[google-reauth]", err);
    return NextResponse.json({ error: { message: "reauth_failed" } }, { status: 500 });
  }
}
