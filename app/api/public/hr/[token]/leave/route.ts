import { NextRequest, NextResponse } from "next/server";
import {
  LeaveOverlapError,
  cancelLeaveByToken,
  createLeaveByToken,
  listLeaveByToken,
} from "@/lib/hr-leave-queries";
import { leaveCreateSchema } from "@/lib/hr-validation";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * การลาของพนักงาน — /api/public/hr/:token/leave
 * staff ทำได้เฉพาะ: ดูของตัวเอง · ขอลา · ยกเลิกใบที่ยัง pending
 * (approve/reject เป็นของ owner เท่านั้น — คนละ endpoint คนละ auth)
 */

function rateLimited(req: NextRequest): NextResponse | null {
  const retryAfter = authRateLimitExceeded(`hr_staff:${clientIp(req)}`);
  return retryAfter === null
    ? null
    : NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const { token } = await params;
  const view = await listLeaveByToken(token);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: view });
}

export async function POST(
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
  const parsed = leaveCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { token } = await params;
  try {
    const leave = await createLeaveByToken(token, parsed.data);
    if (!leave) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: { leave } }, { status: 201 });
  } catch (err) {
    if (err instanceof LeaveOverlapError) {
      return NextResponse.json(
        { error: "leave_overlap", data: { conflict: err.conflict } },
        { status: 409 },
      );
    }
    throw err;
  }
}

/** DELETE ?id= — ยกเลิกคำขอของตัวเองที่ยัง pending */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const { token } = await params;
  const ok = await cancelLeaveByToken(token, id);
  if (ok === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!ok) return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  return NextResponse.json({ data: { ok: true } });
}
