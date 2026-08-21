import { NextRequest, NextResponse } from "next/server";
import { AlreadyWorkingError, staffClockIn } from "@/lib/hr-attendance-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/public/hr/:token/attendance/clock-in
 * body ไม่รับอะไรเลย — เวลา/วันขาย server ตัดสินทั้งหมด (client_timestamp ไร้ผล)
 */
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
    const result = await staffClockIn(token);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AlreadyWorkingError) {
      // กดซ้ำ/กด 2 เครื่อง — DB กันไว้ (idx_attendance_open_once)
      return NextResponse.json({ error: "already_working" }, { status: 409 });
    }
    throw err;
  }
}
