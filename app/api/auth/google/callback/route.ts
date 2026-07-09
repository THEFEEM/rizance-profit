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
import { createGoogleOAuthClient, isGoogleAuthEnabled } from "@/lib/google-oauth";

function loginRedirect(req: NextRequest, error?: string) {
  const url = new URL("/login", req.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: { message: "Google login is not configured" } }, { status: 404 });
  }

  const googleError = req.nextUrl.searchParams.get("error");
  if (googleError) {
    console.error("[google-callback] provider error:", googleError);
    return loginRedirect(req, "google_denied");
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    console.error("[google-callback] missing code");
    return loginRedirect(req, "no_code");
  }

  try {
    const client = createGoogleOAuthClient();
    console.log("[google] redirect_uri used:", process.env.GOOGLE_REDIRECT_URI);
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

    let user = await findUserByGoogleId(googleId);
    let isNewUser = false;

    if (!user) {
      const byEmail = await findUserByEmail(email);
      if (byEmail) {
        user = await linkGoogleAccount(byEmail.id, googleId, picture);
      }
    }

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
    const res = NextResponse.redirect(new URL("/home", req.url));
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
