import { NextRequest, NextResponse } from "next/server";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { registerSchema, fieldErrorsFrom } from "@/lib/validation";
import { createUser, findUserByEmail } from "@/lib/queries";
import { hashPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requestHostname } from "@/lib/jwt";
import { CONTEXT_COOKIE, contextCookieOptions } from "@/lib/context";
import { normalizeRegisterMode } from "@/lib/register-mode";

export async function POST(req: NextRequest) {
  const limited = checkAuthRateLimit(req, "register");
  if (limited) return limited;

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

  const { email, password, shopName, mode } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.authProvider === "google") {
      return NextResponse.json(
        {
          error: {
            message: "อีเมลนี้ใช้ Google เข้าสู่ระบบอยู่แล้ว",
            code: "google_account_exists",
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { message: "That email is already registered", fields: { email: ["Email already in use"] } } },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash, shopName });

  // 4.3C: ไม่เชื่อ mode จาก client — โหมดที่ปลดระวางถูก normalize เป็น Shop ฝั่ง server
  // (ผู้ใช้ใหม่ไม่มีข้อมูลเดิม จึงไม่มีทาง grandfathered · schema default ยังเป็น "personal" → ตกมาที่นี่เช่นกัน)
  const effectiveMode = normalizeRegisterMode(mode);

  let contextValue = "regular";
  let redirect = "/home";
  if (effectiveMode === "personal") {
    contextValue = "personal";
    redirect = "/home";
  } else if (effectiveMode === "org") {
    contextValue = "regular";
    redirect = "/projects/new";
  }

  const token = await signSession(user.id);
  const res = NextResponse.json({ data: { user, redirect } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(requestHostname(req)));
  res.cookies.set(CONTEXT_COOKIE, contextValue, contextCookieOptions());
  return res;
}
