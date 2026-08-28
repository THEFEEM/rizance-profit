import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  AdjustReasonRequiredError,
  WeekAlreadyApprovedError,
  approveManagerWeek,
  managerWeekSummaries,
} from "@/lib/manager-week-queries";
import { z } from "zod";

/**
 * ค่าตอบแทนผู้จัดการรายสัปดาห์ — ฝั่งเจ้าของ
 *
 * GET  ?weekStart=YYYY-MM-DD   สรุปสัปดาห์ (ไม่ส่ง = สัปดาห์นี้)
 * POST                          อนุมัติ — ไม่ส่ง amount = เต็มตามข้อตกลง
 *                               ส่ง amount ต่างจากข้อตกลง = ต้องมี reason
 *
 * อนุมัติเงิน = การตัดสินใจการเงินของร้าน → ต้องอยู่ในโหมดผู้จัดการ (0087)
 * เหมือน approve payroll — ไม่ใช่แค่มีเซสชันร้าน
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const weekStart = new URL(req.url).searchParams.get("weekStart") ?? undefined;
  if (weekStart && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  return NextResponse.json({
    data: { managers: await managerWeekSummaries(userId, weekStart) },
  });
}

const postSchema = z.object({
  employeeId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0).max(1_000_000).nullish(),
  reason: z.string().trim().max(255).nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const result = await approveManagerWeek(userId, parsed.data);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof AdjustReasonRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof WeekAlreadyApprovedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
