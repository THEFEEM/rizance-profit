import { NextRequest, NextResponse } from "next/server";
import { loginSchema, fieldErrorsFrom } from "@/lib/validation";
import { findUserByEmail } from "@/lib/queries";
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
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

  // Same response for unknown email or wrong password (don't leak which).
  if (!found || !(await verifyPassword(password, found.passwordHash))) {
    return NextResponse.json({ error: { message: "Invalid email or password" } }, { status: 401 });
  }

  const { passwordHash: _omit, ...user } = found;
  void _omit;

  const token = await signSession(user.id);
  const res = NextResponse.json({ data: { user } }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
