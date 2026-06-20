import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleUser,
  findUserByEmail,
  findUserByGoogleId,
  linkGoogleAccount,
} from "@/lib/queries";
import { signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
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

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return loginRedirect(req, "google_failed");
  }

  try {
    const client = createGoogleOAuthClient();
    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;
    if (!idToken) {
      return loginRedirect(req, "google_failed");
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return loginRedirect(req, "google_failed");
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
      return loginRedirect(req, "google_failed");
    }

    const token = await signSession(user.id);
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    if (isNewUser) {
      res.cookies.set(CONTEXT_COOKIE, "personal", contextCookieOptions());
    }
    return res;
  } catch {
    return loginRedirect(req, "google_failed");
  }
}
