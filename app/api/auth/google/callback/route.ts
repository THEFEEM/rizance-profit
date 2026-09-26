import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleUser,
  findUserByEmail,
  findUserByGoogleId,
  linkGoogleAccount,
} from "@/lib/queries";
import { signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestHostname } from "@/lib/jwt";
import { CONTEXT_COOKIE, contextCookieOptions } from "@/lib/context";
import { canonicalRedirectTarget } from "@/lib/env";
import {
  authorizeGoogleReauth,
  createGoogleOAuthClient,
  isGoogleAuthEnabled,
  resolveVerifiedGoogleEmail,
} from "@/lib/google-oauth";
import { getCurrentUser } from "@/lib/session";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_PURPOSE_REAUTH,
  REAUTH_DEFAULT_RETURN_TO,
  REAUTH_MAX_AUTH_AGE_SECONDS,
  clearOAuthStateCookie,
  issueReauthProof,
  safeReturnTo,
  verifyOAuthState,
} from "@/lib/oauth-state";

/** ทุกเส้นทางที่ออกจาก callback ต้องล้าง state cookie — ใช้ครั้งเดียวเท่านั้น */
function withStateCleared(res: NextResponse) {
  const c = clearOAuthStateCookie();
  res.cookies.set(c.name, c.value, c.options);
  return res;
}

function loginRedirect(req: NextRequest, error?: string) {
  const url = new URL("/login", req.url);
  if (error) url.searchParams.set("error", error);
  return withStateCleared(NextResponse.redirect(url));
}

function reauthRedirect(req: NextRequest, returnTo: string, status: "ok" | "failed") {
  const url = new URL(safeReturnTo(returnTo, REAUTH_DEFAULT_RETURN_TO), req.url);
  url.searchParams.set("reauth", status);
  return withStateCleared(NextResponse.redirect(url));
}

export async function GET(req: NextRequest) {
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: { message: "Google login is not configured" } }, { status: 404 });
  }

  // ── Canonical host ก่อนทุกอย่าง ─────────────────────────────────────
  // state cookie เป็น host-only บน canonical host (ตั้งตอนเริ่ม flow ที่ /api/auth/google)
  // ถ้า Google ส่งกลับมาที่ host อื่น (เช่น rizance.app ตาม redirect_uri เดิม) จะไม่มี
  // cookie ให้ตรวจ → ต้องพา request ทั้งก้อน (path + code + state + error) ไป canonical
  // แล้วให้ verifyOAuthState ทำงานตามปกติที่นั่น — **ไม่ได้ข้ามการตรวจ** แค่ย้ายที่ตรวจ
  //
  // ปลายทางมาจาก config เท่านั้น (getAppUrl) ไม่ใช่จาก Host header → ไม่มี open redirect
  // /api/* ไม่ผ่าน middleware จึงต้องมี guard ตรงนี้เอง
  const canonical = canonicalRedirectTarget(
    requestHostname(req),
    req.nextUrl.pathname,
    req.nextUrl.search,
  );
  if (canonical) {
    return NextResponse.redirect(canonical, 308);
  }

  const googleError = req.nextUrl.searchParams.get("error");
  if (googleError) {
    console.error("[google-callback] provider error:", googleError);
    return loginRedirect(req, "google_denied");
  }

  // ── A-3.SEC · ตรวจ state ก่อนแตะ code ─────────────────────────────
  // ต้องทำก่อนแลก token เสมอ — ไม่งั้นเราจะยอมแลก code ที่ผู้โจมตีป้อนมา
  const oauthState = await verifyOAuthState(
    req.cookies.get(OAUTH_STATE_COOKIE)?.value,
    req.nextUrl.searchParams.get("state"),
  );
  if (!oauthState) {
    console.error("[google-callback] state rejected");
    return loginRedirect(req, "bad_state");
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    console.error("[google-callback] missing code");
    return loginRedirect(req, "no_code");
  }

  try {
    const client = createGoogleOAuthClient();
    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;
    if (!idToken) {
      console.error("[google-callback] missing id_token");
      return loginRedirect(req, "google_callback");
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      console.error("[google-callback] invalid token payload");
      return loginRedirect(req, "google_callback");
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const name = payload.name?.trim();
    const picture = payload.picture ?? null;

    // ── SEC-3 · เส้นทางยืนยันตัวตนสด ───────────────────────────────
    // ห้ามสร้าง/ผูกบัญชีใด ๆ ในเส้นทางนี้ และห้ามออก session ใหม่
    if (oauthState.purpose === OAUTH_PURPOSE_REAUTH) {
      const returnTo = oauthState.returnTo ?? REAUTH_DEFAULT_RETURN_TO;

      // ยืนยันตัวตนจาก DB อีกครั้ง — ผู้ใช้อาจถูกลบระหว่างที่อยู่หน้า Google
      const current = await getCurrentUser();
      // ★ ตัวชี้ขาดตัวตน: google_id ที่ผูกไว้ ไม่ใช่สิ่งที่ผู้ใช้เลือกบนหน้าจอ Google
      //   เข้าด้วยบัญชี Google อื่น → linked เป็น null หรือคนละ id → ปฏิเสธ
      const linked = await findUserByGoogleId(googleId);

      const decision = authorizeGoogleReauth({
        stateUserId: oauthState.uid,
        currentUserId: current?.id,
        googleLinkedUserId: linked?.id,
      });
      if (!decision.ok || !current) {
        console.error(`[google-reauth] denied: ${decision.ok ? "no_current_user" : decision.reason}`);
        return reauthRedirect(req, returnTo, "failed");
      }

      // ความสดฝั่ง Google: ขอ max_age=0 ไว้ ถ้ามี auth_time ต้องอยู่ในกรอบ
      // log เฉพาะ boolean — ไม่มี id · ไม่มีอีเมล · ไม่มี token · ไม่มี state
      const authTime = (payload as { auth_time?: number }).auth_time;
      if (typeof authTime === "number" && Date.now() / 1000 - authTime > REAUTH_MAX_AUTH_AGE_SECONDS) {
        console.error("[google-reauth] denied: auth_time too old");
        return reauthRedirect(req, returnTo, "failed");
      }
      console.log(`[google-reauth] ok (auth_time present: ${typeof authTime === "number"})`);

      const proof = await issueReauthProof(current.id);
      const res = reauthRedirect(req, returnTo, "ok");
      res.cookies.set(proof.name, proof.value, proof.options);
      return res;
    }

    // จับคู่ด้วย google_id ก่อนเสมอ — ไม่พึ่งอีเมล จึงไม่ต้องตรวจ email_verified
    let user = await findUserByGoogleId(googleId);
    let isNewUser = false;

    // ── A-3.SEC-4 · ตั้งแต่บรรทัดนี้ลงไป "อีเมลคือตัวผูกตัวตน" ──────────
    // ต้องเป็นอีเมลที่ Google ยืนยันแล้วเท่านั้น ไม่งั้นปฏิเสธทั้ง link และ create
    if (!user) {
      const binding = resolveVerifiedGoogleEmail(payload);
      if (!binding.ok) {
        // ข้อความเดียวกันทุกกรณี — ไม่บอกใบ้ว่ามีบัญชีนี้อยู่หรือไม่
        console.error(`[google-callback] email binding refused: ${binding.reason}`);
        return loginRedirect(req, "google_unverified_email");
      }

      const byEmail = await findUserByEmail(binding.email);
      if (byEmail) {
        user = await linkGoogleAccount(byEmail.id, googleId, picture);
      }
    }

    // ถึงตรงนี้ได้เฉพาะเมื่อ resolveVerifiedGoogleEmail ผ่านแล้วเท่านั้น
    // (`email` คือค่าเดียวกับ binding.email — normalize แบบเดียวกันที่บรรทัดบน)
    if (!user) {
      const displayName = name || email.split("@")[0];
      const shopName = name || displayName;
      isNewUser = true;
      user = await createGoogleUser({
        email,
        googleId,
        displayName,
        avatarUrl: picture,
        shopName,
      });
    }

    if (!user) {
      console.error("[google-callback] user resolution failed");
      return loginRedirect(req, "google_callback");
    }

    const token = await signSession(user.id);
    // AUTH-HOTFIX-1: returnTo ใน state cookie ผ่าน safeReturnTo แล้ว (path ภายในเท่านั้น) · ไม่มี → /home เหมือนเดิม
    const landing = safeReturnTo(oauthState.returnTo, "/home");
    const res = withStateCleared(NextResponse.redirect(new URL(landing, req.url)));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(requestHostname(req)));
    if (isNewUser) {
      res.cookies.set(CONTEXT_COOKIE, "personal", contextCookieOptions());
    }
    return res;
  } catch (err) {
    console.error("[google-callback]", err);
    return loginRedirect(req, "google_callback");
  }
}
