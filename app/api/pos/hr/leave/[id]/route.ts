import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  LeaveNotFoundError,
  LeaveOverlapError,
  LeaveStateError,
  cancelLeaveByOwner,
  reviewLeave,
} from "@/lib/hr-leave-queries";
import { leaveReviewSchema } from "@/lib/hr-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH — approve / reject (เหตุผลบังคับ) / cancel */
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
  const parsed = leaveReviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const leave =
      parsed.data.action === "cancel"
        ? await cancelLeaveByOwner(userId, id)
        : await reviewLeave(userId, id, {
            decision: parsed.data.action,
            note: parsed.data.note ?? null,
          });
    return NextResponse.json({ data: { leave } });
  } catch (err) {
    if (err instanceof LeaveNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof LeaveStateError) {
      return NextResponse.json({ error: "invalid_state" }, { status: 409 });
    }
    if (err instanceof LeaveOverlapError) {
      return NextResponse.json(
        { error: "leave_overlap", data: { conflict: err.conflict } },
        { status: 409 },
      );
    }
    throw err;
  }
}
