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
    // A-3.SEC: ไม่รับ returnTo จาก client — flow ล็อกอินไป /home เสมอ
    // (สเปกสั่งว่าอย่าเพิ่ม returnTo แบบพลวัตถ้าไม่จำเป็น)
    const oauth = await createOAuthState({ purpose: OAUTH_PURPOSE_LOGIN });
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
