import { NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient, isGoogleAuthEnabled } from "@/lib/google-oauth";

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
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
    });
    console.log("[google] auth url:", url);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[google-auth]", err);
    return loginRedirect(req, "google_callback");
  }
}
