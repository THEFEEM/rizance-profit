import { NextRequest, NextResponse } from "next/server";
import { getStaffOverview } from "@/lib/hr-staff-overview-queries";
import { staffRateLimitExceeded } from "@/lib/rate-limit";

/**
 * GET /api/public/hr/:token/overview — ข้อมูลหน้าแรกแอปพนักงานครบใน 1 request
 * (โปรไฟล์ · กะวันนี้/ถัดไป · เพื่อนร่วมกะ · ประมาณการเงิน · งวดที่จ่ายแล้ว · ต้องสะสาง)
 *
 * ตัวเลขเงินทั้งหมดยกเว้น paid[] คือ "ประมาณการ" — UI ต้องกำกับคำเตือนเสมอ
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
  const overview = await getStaffOverview(token);
  if (!overview) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: overview });
}
