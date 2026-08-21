import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { listAttendance } from "@/lib/hr-attendance-queries";
import { attendanceFilterSchema } from "@/lib/hr-validation";

/** GET /api/pos/hr/attendance?date&employeeId&branchId&status — owner เท่านั้น */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = req.nextUrl.searchParams;
  const parsed = attendanceFilterSchema.safeParse({
    date: sp.get("date") ?? undefined,
    employeeId: sp.get("employeeId") ?? undefined,
    branchId: sp.get("branchId") ?? undefined,
    status: sp.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await listAttendance(userId, parsed.data);
  return NextResponse.json({ data: result });
}
