import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PayrollImmutableError,
  PayrollInvariantError,
  PayrollNotFoundError,
  PayrollStateError,
  addAdjustLine,
  approvePayroll,
  getPayrollDetail,
  regeneratePayroll,
  removeAdjustLine,
  setPayrollStatus,
} from "@/lib/hr-payroll-queries";
import { payrollPatchSchema } from "@/lib/hr-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const detail = await getPayrollDetail(userId, id);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: detail });
}

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
  const parsed = payrollPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const a = parsed.data;
    if (a.action === "approve") {
      // สร้าง expense จริง — idempotent (retry ได้ ไม่มี expense ซ้ำ)
      const detail = await approvePayroll(userId, id);
      return NextResponse.json({ data: detail });
    }
    if (a.action === "regenerate") {
      await regeneratePayroll(userId, id);
    } else if (a.action === "add_line") {
      await addAdjustLine(userId, id, a);
    } else if (a.action === "remove_line") {
      await removeAdjustLine(userId, id, a.lineId);
    } else {
      await setPayrollStatus(userId, id, a.action);
    }
    const detail = await getPayrollDetail(userId, id);
    return NextResponse.json({ data: detail });
  } catch (err) {
    if (err instanceof PayrollNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof PayrollImmutableError) {
      return NextResponse.json({ error: "payroll_immutable" }, { status: 409 });
    }
    if (err instanceof PayrollStateError) {
      return NextResponse.json({ error: "invalid_state" }, { status: 409 });
    }
    if (err instanceof PayrollInvariantError) {
      return NextResponse.json({ error: "invariant_failed" }, { status: 400 });
    }
    if ((err as { code?: string }).code === "23514") {
      // DB CHECK — เช่นหักเงินเกิน gross จน net ติดลบ
      return NextResponse.json({ error: "deduction_exceeds" }, { status: 400 });
    }
    throw err;
  }
}
