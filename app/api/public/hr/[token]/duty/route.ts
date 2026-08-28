import { NextRequest, NextResponse } from "next/server";
import {
  DutyItemNotFoundError,
  DutyReasonRequiredError,
  ManagerDutyNotFoundError,
  ManagerDutyNotOpenError,
  NotManagerError,
  completeDuty,
  managerWeek,
  openDuty,
  setDutyItemStatus,
} from "@/lib/manager-duty-queries";
import { staffRateLimitExceeded } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * รอบงานผู้จัดการ — ฝั่งแอปพนักงาน /e/[token]
 *
 * GET    → สถานะสัปดาห์ (กี่รอบ/เป้า · ค่าจ้างข้อตกลง · รอบวันนี้)
 * POST   → เปิดรอบวันนี้ (เปิดซ้ำ = คืนรอบเดิม)
 * PATCH  → อัปเดตรายการงาน (done / not_required+เหตุผล / issue→สมุดร้าน / pending)
 * PUT    → ปิดรอบ + summary snapshot (กดซ้ำ = คืนรอบเดิม)
 *
 * ═══ ความปลอดภัย ═══════════════════════════════════════════════
 * ทุก method พิสูจน์ token → employees → hr_role='manager' ที่ server
 * client ส่ง isManager มาไม่มีความหมาย — เราไม่อ่าน body หาสิทธิ์เลย
 * พนักงานปกติเรียก endpoint นี้ได้ 403 not_manager
 */

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = staffRateLimitExceeded(req);
  return retryAfter === null
    ? null
    : NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
}

function mapError(err: unknown): NextResponse | null {
  if (err instanceof NotManagerError) {
    return NextResponse.json({ error: "not_manager" }, { status: 403 });
  }
  if (err instanceof ManagerDutyNotFoundError || err instanceof DutyItemNotFoundError) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
  if (err instanceof ManagerDutyNotOpenError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof DutyReasonRequiredError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;
  try {
    const week = await managerWeek(token);
    if (!week) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: week });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;
  try {
    return NextResponse.json({ data: { duty: await openDuty(token) } }, { status: 201 });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}

const patchSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(["pending", "done", "not_required", "issue"]),
  reason: z.string().trim().max(255).nullish(),
  issueTitle: z.string().trim().max(160).nullish(),
  issueBody: z.string().trim().max(2000).nullish(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    return NextResponse.json({ data: { item: await setDutyItemStatus(token, parsed.data) } });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}

const putSchema = z.object({
  ownerNote: z.string().trim().max(2000).nullish(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { token } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = putSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    return NextResponse.json({ data: { duty: await completeDuty(token, parsed.data) } });
  } catch (err) {
    const mapped = mapError(err);
    if (mapped) return mapped;
    throw err;
  }
}
