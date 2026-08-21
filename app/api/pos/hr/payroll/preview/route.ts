import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { previewPayroll } from "@/lib/hr-payroll-queries";
import { payrollCreateSchema } from "@/lib/hr-validation";

/** POST /api/pos/hr/payroll/preview — คำนวณอย่างเดียว ไม่เขียนอะไรทั้งสิ้น */
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

  const preview = await previewPayroll(
    userId,
    parsed.data.periodStart,
    parsed.data.periodEnd,
  );
  return NextResponse.json({ data: preview });
}
