import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { managerDutyWeek } from "@/lib/hr-ops-queries";
import { z } from "zod";

/**
 * GET /api/pos/hr/manager-duty?from=&to= — รอบ Duty ของผู้จัดการในช่วงวันที่
 *
 * อ่านอย่างเดียว ไม่สร้างรายการ (ผู้สร้างมีที่เดียวคือแอปผู้จัดการ)
 * ตั้งต้นจากกะที่จัดไว้ → เจ้าของเห็นรอบที่ยังไม่เริ่มด้วย
 */

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (parsed.data.from > parsed.data.to) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const days = await managerDutyWeek(userId, parsed.data.from, parsed.data.to);
  return NextResponse.json({ data: { days } });
}
