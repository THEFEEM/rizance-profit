import { NextRequest, NextResponse } from "next/server";
import { NoActiveAttendanceError, staffClockOut } from "@/lib/hr-attendance-queries";
import { staffClosingGate } from "@/lib/hr-ops-queries";
import { clockRateLimitExceeded } from "@/lib/rate-limit";

/**
 * POST /api/public/hr/:token/attendance/clock-out — server ตัดสินเวลาเสมอ
 * body (optional): {force?: boolean, overrideReason?: string}
 *
 * 0084: ไม่มีด่าน checklist แล้ว — เลิกงานได้เสมอ
 * staffClosingGate ยังถูกเรียกอยู่เพราะทำ 2 อย่างที่ยังจำเป็น:
 *   1) ปิดเบรกที่ค้าง (เวลาพักไม่หาย)
 *   2) ถ้าเป็นผู้จัดการที่ Duty ไม่ครบ → บันทึกลง audit ให้เจ้าของเห็น
 * คืน dutyRemaining กลับไปด้วยเพื่อให้แอปแสดงเตือนเบา ๆ ได้ (ไม่บล็อก)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const retryAfter = clockRateLimitExceeded(req);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let opts: { force?: boolean; overrideReason?: string } = {};
  try {
    const body = (await req.json()) as { force?: boolean; overrideReason?: string };
    if (body && typeof body === "object") {
      opts = {
        force: body.force === true,
        overrideReason:
          typeof body.overrideReason === "string"
            ? body.overrideReason.slice(0, 255)
            : undefined,
      };
    }
  } catch {
    // body ว่าง = พฤติกรรมเดิม
  }

  const { token } = await params;
  const gate = await staffClosingGate(token, opts);
  if (!gate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const result = await staffClockOut(token);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: { ...result, dutyRemaining: gate.remaining } });
  } catch (err) {
    if (err instanceof NoActiveAttendanceError) {
      return NextResponse.json({ error: "not_working" }, { status: 409 });
    }
    throw err;
  }
}
