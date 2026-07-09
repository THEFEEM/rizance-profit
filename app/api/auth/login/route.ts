import { NextRequest, NextResponse } from "next/server";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { loginSchema, fieldErrorsFrom } from "@/lib/validation";
import { findUserByEmail } from "@/lib/queries";
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestHostname } from "@/lib/jwt";

export async function POST(req: NextRequest) {
  const limited = checkAuthRateLimit(req, "login");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;
  const found = await findUserByEmail(email);

  if (!found) {
    return NextResponse.json({ error: { message: "Invalid email or password" } }, { status: 401 });
  }

  if (!found.passwordHash) {
    return NextResponse.json(
      { error: { message: "ใช้ Google เข้าสู่ระบบ", code: "google_only" } },
      { status: 400 },
    );
  }

  if (!(await verifyPassword(password, found.passwordHash))) {
    return NextResponse.json({ error: { message: "Invalid email or password" } }, { status: 401 });
  }

  const { passwordHash: _omit, ...user } = found;
  void _omit;

  const token = await signSession(user.id);
  const res = NextResponse.json({ data: { user } }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(requestHostname(req)));
  return res;
}
