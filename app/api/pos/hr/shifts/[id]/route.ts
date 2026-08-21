import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  ShiftNotFoundError,
  ShiftOverlapError,
  getShift,
  updateShift,
} from "@/lib/hr-shift-queries";
import { shiftPatchSchema } from "@/lib/hr-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const shift = await getShift(userId, id);
  if (!shift) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { shift } });
}

/** PATCH — แก้เวลา/ย้ายคน/ย้ายวัน/เปลี่ยนสถานะ (cancel · absent — owner ตัดสิน) */
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
  const parsed = shiftPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const shift = await updateShift(userId, id, parsed.data);
    return NextResponse.json({ data: { shift } });
  } catch (err) {
    if (err instanceof ShiftOverlapError) {
      return NextResponse.json(
        { error: "shift_overlap", data: { conflict: err.conflict } },
        { status: 409 },
      );
    }
    if (err instanceof ShiftNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
