import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  ShiftNotFoundError,
  ShiftOverlapError,
  copyShifts,
  createShift,
  listShifts,
} from "@/lib/hr-shift-queries";
import { shiftCreateSchema } from "@/lib/hr-validation";

/** ตารางกะ (owner เท่านั้น) */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const shifts = await listShifts(userId, {
    from,
    to,
    employeeId: sp.get("employeeId") ?? undefined,
    branchId: sp.get("branchId") ?? undefined,
  });
  return NextResponse.json({ data: { shifts } });
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
  const parsed = shiftCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    if ("action" in parsed.data) {
      const days = parsed.data.action === "copy_week" ? 7 : 1;
      const result = await copyShifts(userId, {
        from: parsed.data.from,
        to: parsed.data.to,
        days,
      });
      return NextResponse.json({ data: result });
    }
    const shift = await createShift(userId, parsed.data);
    return NextResponse.json({ data: { shift } }, { status: 201 });
  } catch (err) {
    if (err instanceof ShiftOverlapError) {
      // เตือนพร้อมบอกกะที่ชน — UI เอาไปแสดง "มีกะ 16:00-22:00 อยู่แล้ว"
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
