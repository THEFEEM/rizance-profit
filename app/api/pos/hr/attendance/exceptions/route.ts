import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { listAttendanceExceptions } from "@/lib/hr-leave-queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/pos/hr/attendance/exceptions?from&to — ของที่ต้องสะสาง */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = req.nextUrl.searchParams;
  const to = sp.get("to") ?? "";
  const from = sp.get("from") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const exceptions = await listAttendanceExceptions(userId, { from, to });
  return NextResponse.json({ data: { exceptions } });
}
