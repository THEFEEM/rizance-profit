import { NextRequest, NextResponse } from "next/server";
import { NoActiveAttendanceError, staffClockOut } from "@/lib/hr-attendance-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/** POST /api/public/hr/:token/attendance/clock-out — server ตัดสินเวลาเสมอ */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryAfter = authRateLimitExceeded(`hr_clock:${clientIp(req)}`);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { token } = await params;
  try {
    const result = await staffClockOut(token);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof NoActiveAttendanceError) {
      return NextResponse.json({ error: "not_working" }, { status: 409 });
    }
    throw err;
  }
}
