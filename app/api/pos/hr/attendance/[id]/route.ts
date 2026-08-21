import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  AttendanceNotFoundError,
  adjustAttendance,
  getAttendance,
} from "@/lib/hr-attendance-queries";
import { attendanceAdjustSchema } from "@/lib/hr-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const record = await getAttendance(userId, id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { record } });
}

/** PATCH — ปรับเวลา/ยกเลิก · reason บังคับ · ลง adjustment + audit เสมอ */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = attendanceAdjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const record = await adjustAttendance(userId, id, {
      ...("cancel" in parsed.data ? { cancel: true } : parsed.data),
      reason: parsed.data.reason,
      note: parsed.data.note,
    });
    return NextResponse.json({ data: { record } });
  } catch (err) {
    if (err instanceof AttendanceNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if ((err as { code?: string }).code === "23514") {
      // CHECK: clock_out ต้อง ≥ clock_in
      return NextResponse.json({ error: "invalid_time_range" }, { status: 400 });
    }
    throw err;
  }
}
