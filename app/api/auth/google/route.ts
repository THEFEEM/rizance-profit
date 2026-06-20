import { NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient, isGoogleAuthEnabled } from "@/lib/google-oauth";

export async function GET(_req: NextRequest) {
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: { message: "Google login is not configured" } }, { status: 404 });
  }

  const client = createGoogleOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });

  return NextResponse.redirect(url);
}
