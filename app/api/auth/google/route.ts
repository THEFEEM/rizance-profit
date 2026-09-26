import { NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient, isGoogleAuthEnabled } from "@/lib/google-oauth";
import { createOAuthState, OAUTH_PURPOSE_LOGIN } from "@/lib/oauth-state";

function loginRedirect(req: NextRequest, error: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: { message: "Google login is not configured" } }, { status: 404 });
  }

  try {
    const client = createGoogleOAuthClient();
    // AUTH-HOTFIX-1: รับ ?next= เป็น **path ภายในเท่านั้น** (createOAuthState ผ่าน safeReturnTo ให้)
    // เก็บใน state cookie httpOnly ที่ลงลายเซ็น — ไม่ได้อยู่ใน `state` ที่ส่งไป Google
    // ใช้พา POS handoff กลับมาที่ /api/pos/handoff หลังล็อกอิน · ค่าอื่น/ไม่ปลอดภัย → /home เหมือนเดิม
    const next = req.nextUrl.searchParams.get("next");
    const oauth = await createOAuthState({
      purpose: OAUTH_PURPOSE_LOGIN,
      ...(next ? { returnTo: next } : {}),
    });
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      state: oauth.state,
    });
    // ⚠️ ห้าม log auth URL — มันมี state อยู่ข้างใน
    const res = NextResponse.redirect(url);
    res.cookies.set(oauth.cookieName, oauth.cookieValue, oauth.cookieOptions);
    return res;
  } catch (err) {
    console.error("[google-auth]", err);
    return loginRedirect(req, "google_callback");
  }
}
