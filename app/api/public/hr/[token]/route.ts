import { NextRequest, NextResponse } from "next/server";
import { getStaffProfileByToken } from "@/lib/hr-employee-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * GET /api/public/hr/:token — Staff Mode: โปรไฟล์ของตัวเองเท่านั้น
 *
 * Security:
 * - token ถูก hash ก่อน lookup (DB ไม่มี token จริง)
 * - เงื่อนไข active + ยังไม่หมดอายุ อยู่ใน query เดียว
 * - ทุกเคสที่ไม่ผ่าน = 404 เดียวกัน ไม่บอกเหตุผล (กัน enumeration)
 * - rate limit ต่อ IP กันไล่เดา token
 */
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
  const profile = await getStaffProfileByToken(token);
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: profile });
}
