import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPoolSettings, updatePoolSettings } from "@/lib/hr-daily-pool-queries";
import { z } from "zod";

/** โหมดจ่ายเงิน (รายชั่วโมง / เงินกองกลาง) + อัตราผู้จัดการ + ลาที่ได้เงิน */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { settings: await getPoolSettings(userId) } });
}

const patchSchema = z.object({
  payrollMode: z.enum(["hourly", "daily_pool"]).optional(),
  managerDailyRate: z.number().min(0).max(1_000_000).optional(),
  paidLeaveTypes: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
});

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  await updatePoolSettings(userId, parsed.data);
  return NextResponse.json({ data: { settings: await getPoolSettings(userId) } });
}
