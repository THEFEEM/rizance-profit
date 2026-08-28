import { NextRequest, NextResponse } from "next/server";
import { staffPayroll } from "@/lib/hr-payroll-queries";
import { staffRateLimitExceeded } from "@/lib/rate-limit";

/**
 * GET /api/public/hr/:token/payroll — เงินของฉัน (posted เท่านั้น)
 * draft/review ไม่โชว์ — ตัวเลขที่ยังไม่ finalized ห้ามหลุดถึงพนักงาน
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryAfter = staffRateLimitExceeded(req);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { token } = await params;
  const view = await staffPayroll(token);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: view });
}
