import { NextRequest, NextResponse } from "next/server";
import { registerSchema, fieldErrorsFrom } from "@/lib/validation";
import { createUser, emailExists } from "@/lib/queries";
import { hashPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const { email, password, shopName } = parsed.data;

  if (await emailExists(email)) {
    return NextResponse.json(
      { error: { message: "That email is already registered", fields: { email: ["Email already in use"] } } },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash, shopName });

  const token = await signSession(user.id);
  const res = NextResponse.json({ data: { user } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
