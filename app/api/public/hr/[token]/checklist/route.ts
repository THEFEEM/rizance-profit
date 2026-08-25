import { NextRequest, NextResponse } from "next/server";
import { staffChecklist, staffToggleChecklistItem } from "@/lib/hr-ops-queries";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = authRateLimitExceeded(`hr_staff:${clientIp(req)}`);
  return retryAfter === null
    ? null
    : NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
}

/**
 * GET — Manager Duty ของวันนี้
 * ผู้จัดการที่มีกะวันนั้น → hasDuty=true + รายการ 11 ข้อ (สร้างอัตโนมัติครั้งแรก)
 * คนอื่น / วันที่ไม่มีกะ → hasDuty=false + รายการว่าง (ไม่ error)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;
  const view = await staffChecklist(token);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: view });
}

/** PATCH {itemId, done} — ติ๊ก/ยกเลิกติ๊ก (verified แล้วแตะไม่ได้) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { itemId, done } = (body ?? {}) as { itemId?: string; done?: boolean };
  if (typeof itemId !== "string" || typeof done !== "boolean") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { token } = await params;
  const ok = await staffToggleChecklistItem(token, itemId, done);
  if (ok === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { ok: true } });
}
