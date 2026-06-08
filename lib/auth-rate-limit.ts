import { NextRequest, NextResponse } from "next/server";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/** Returns a 429 response when the IP exceeds the auth attempt limit, else null. */
export function checkAuthRateLimit(req: NextRequest, action: "login" | "register"): NextResponse | null {
  const retryAfter = authRateLimitExceeded(`${action}:${clientIp(req)}`);
  if (retryAfter === null) return null;

  return NextResponse.json(
    { error: { message: "Too many attempts. Please wait and try again." } },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
}
