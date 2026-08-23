import { NextRequest, NextResponse } from "next/server";
import { NoActiveAttendanceError, staffClockOut } from "@/lib/hr-attendance-queries";
import { staffClosingGate } from "@/lib/hr-ops-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/public/hr/:token/attendance/clock-out — server ตัดสินเวลาเสมอ
 * body (optional): {force?: boolean, overrideReason?: string}
 * ด่าน checklist ปิดร้าน (0082): งานค้าง → 409 พร้อมจำนวน · force = ผ่านได้
 * แต่บันทึกเหตุผลลง audit + งานค้างโผล่ฝั่งเจ้าของร้าน
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
  if (!gate.ok) {
    return NextResponse.json(
      { error: "checklist_incomplete", data: { remaining: gate.remaining } },
      { status: 409 },
    );
  }

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
