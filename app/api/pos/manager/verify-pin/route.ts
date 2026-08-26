import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { logManager, verifyPin } from "@/lib/manager-pin-queries";
import { managerCookieOptions, signManagerUnlock, MANAGER_COOKIE } from "@/lib/manager-unlock";
import { requestHostname } from "@/lib/jwt";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/pos/manager/verify-pin — ปลดล็อกโหมดผู้จัดการ
 *
 * ═══ ด่านกันเดารหัส 2 ชั้น ═════════════════════════════════════
 * 1) rate limiter ตาม IP (ของเดิม) — กันยิงถี่
 * 2) ตัวนับใน DB — กันเดาข้ามเครื่อง/ข้าม instance
 *    (serverless เปลี่ยน instance ตลอด นับในหน่วยความจำอย่างเดียวกันไม่ได้)
 *
 * ═══ ข้อความตอบกลับ ═══════════════════════════════════════════
 * ผิดรหัสกับโดนล็อกตอบต่างกันเท่าที่จำเป็นให้ผู้ใช้รู้ว่าต้องรอ
 * แต่ไม่บอกอะไรที่ช่วยให้เดาได้ง่ายขึ้น และไม่คืน hash/เวอร์ชันเด็ดขาด
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const retryAfter = authRateLimitExceeded(`mgr_pin:${clientIp(req)}`);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let pin = "";
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const result = await verifyPin(userId, pin);

  if (!result.ok) {
    if (result.reason === "not_set") return posErrorResponse("setup_required", 409);
    if (result.reason === "locked") {
      await logManager(userId, "manager_pin_failed", { locked: true });
      return NextResponse.json(
        { error: "too_many_attempts" },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds ?? 900) },
        },
      );
    }
    await logManager(userId, "manager_pin_failed");
    return posErrorResponse("invalid_pin", 401);
  }

  await logManager(userId, "manager_pin_verified");
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(
    MANAGER_COOKIE,
    await signManagerUnlock(userId, result.version),
    managerCookieOptions(requestHostname(req)),
  );
  return res;
}
