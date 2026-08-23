import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  computeDay,
  getPoolConfig,
  getPoolSettings,
  persistDay,
  setPoolAmount,
  summarizePeriod,
} from "@/lib/hr-daily-pool-queries";
import { z } from "zod";

/** เงินกองกลางรายวัน — ตั้งค่า + ดูผลการแบ่ง (owner เท่านั้น) */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  const from = sp.get("from");
  const to = sp.get("to");

  // วันเดียว = breakdown รายคน
  if (date && DATE_RE.test(date)) {
    return NextResponse.json({ data: { day: await computeDay(userId, date) } });
  }
  // ช่วง = สรุปสัปดาห์/งวด
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    const [summary, config, settings] = await Promise.all([
      summarizePeriod(userId, from, to),
      getPoolConfig(userId),
      getPoolSettings(userId),
    ]);
    return NextResponse.json({ data: { summary, config, settings } });
  }
  // ไม่ระบุ = แค่ config + settings
  const [config, settings] = await Promise.all([
    getPoolConfig(userId),
    getPoolSettings(userId),
  ]);
  return NextResponse.json({ data: { config, settings } });
}

const patchSchema = z.union([
  z.object({
    action: z.literal("set_pool"),
    dayOfWeek: z.number().int().min(0).max(6),
    amount: z.number().min(0).max(1_000_000),
    effectiveFrom: z.string().regex(DATE_RE),
  }),
  z.object({
    action: z.literal("recalculate"),
    date: z.string().regex(DATE_RE),
  }),
]);

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

  if (parsed.data.action === "set_pool") {
    await setPoolAmount(
      userId,
      parsed.data.dayOfWeek,
      parsed.data.amount,
      parsed.data.effectiveFrom,
    );
    return NextResponse.json({ data: { config: await getPoolConfig(userId) } });
  }
  const day = await persistDay(userId, parsed.data.date);
  return NextResponse.json({ data: { day } });
}
