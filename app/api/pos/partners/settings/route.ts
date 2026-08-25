import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPartnerSettings, updatePartnerSettings } from "@/lib/pos-partner-queries";
import { z } from "zod";

/**
 * ตั้งค่าสิทธิ์หุ้นส่วน
 *
 * ⚠️ allowBelowCost = true คือการยอมขายขาดทุนให้หุ้นส่วน
 *    ค่าตั้งต้นคือ false และควรอยู่แบบนั้น — เปิดต้องตั้งใจจริง
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const s = await getPartnerSettings(userId);
  return NextResponse.json({ data: { settings: s.view } });
}

const patchSchema = z
  .object({
    minProfitPerItem: z.number().finite().gte(0).lte(100_000).optional(),
    maxDiscountPercent: z.number().finite().gte(0).lte(100).optional(),
    allowBelowCost: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "at least one field" });

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

  return NextResponse.json({
    data: { settings: await updatePartnerSettings(userId, parsed.data) },
  });
}
