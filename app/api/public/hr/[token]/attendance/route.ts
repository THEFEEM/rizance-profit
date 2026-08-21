import { NextRequest, NextResponse } from "next/server";
import { staffAttendance } from "@/lib/hr-attendance-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/** GET /api/public/hr/:token/attendance — เวลาของฉัน (เฉพาะตัวเอง 7 วันขายล่าสุด) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryAfter = authRateLimitExceeded(`hr_staff:${clientIp(req)}`);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { token } = await params;
  const view = await staffAttendance(token);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: view });
}
