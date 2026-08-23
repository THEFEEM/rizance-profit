import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  LeaveNotFoundError,
  LeaveOverlapError,
  createLeaveByOwner,
  listLeaves,
  type LeaveStatus,
} from "@/lib/hr-leave-queries";
import { leaveOwnerCreateSchema } from "@/lib/hr-validation";

/** การลา — ฝั่งเจ้าของร้าน */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const status = req.nextUrl.searchParams.get("status") as LeaveStatus | null;
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  const result = await listLeaves(userId, {
    status: status ?? undefined,
    employeeId: employeeId ?? undefined,
  });
  return NextResponse.json({ data: result });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = leaveOwnerCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const leave = await createLeaveByOwner(userId, parsed.data);
    return NextResponse.json({ data: { leave } }, { status: 201 });
  } catch (err) {
    if (err instanceof LeaveOverlapError) {
      return NextResponse.json(
        { error: "leave_overlap", data: { conflict: err.conflict } },
        { status: 409 },
      );
    }
    if (err instanceof LeaveNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
