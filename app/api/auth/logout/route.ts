import { NextResponse } from "next/server";
import { SESSION_COOKIE, clearSessionCookieOptions } from "@/lib/jwt";

export async function POST() {
  const res = NextResponse.json({ data: { ok: true } }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions());
  return res;
}
