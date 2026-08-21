import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PayrollPeriodExistsError,
  createPayrollPeriod,
  laborCostSummary,
  listPayrollPeriods,
} from "@/lib/hr-payroll-queries";
import { payrollCreateSchema } from "@/lib/hr-validation";

/** GET — งวดทั้งหมด + labor cost เดือนนี้ (owner เท่านั้น) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const [periods, labor] = await Promise.all([
    listPayrollPeriods(userId),
    laborCostSummary(userId),
  ]);
  return NextResponse.json({ data: { periods, labor } });
}

/** POST — สร้างงวด draft + คำนวณจาก attendance (งวดซ้ำ → 409) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = payrollCreateSchema.safeParse(body);
  if (!parsed.success || parsed.data.periodEnd < parsed.data.periodStart) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const detail = await createPayrollPeriod(
      userId,
      parsed.data.periodStart,
      parsed.data.periodEnd,
    );
    return NextResponse.json({ data: detail }, { status: 201 });
  } catch (err) {
    if (err instanceof PayrollPeriodExistsError) {
      return NextResponse.json({ error: "period_exists" }, { status: 409 });
    }
    throw err;
  }
}
