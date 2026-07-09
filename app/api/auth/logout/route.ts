import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, clearSessionCookieOptions, requestHostname } from "@/lib/jwt";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ data: { ok: true } }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions(requestHostname(req)));
  return res;
}
