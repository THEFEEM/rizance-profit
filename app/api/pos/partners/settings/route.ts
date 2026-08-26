import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPartnerSettings, updatePartnerSettings } from "@/lib/pos-partner-queries";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * ตั้งค่าสิทธิ์หุ้นส่วน
 *
 * ⚠️ allowBelowCost = true คือการยอมขายขาดทุนให้หุ้นส่วน
 *    ค่าตั้งต้นคือ false และควรอยู่แบบนั้น — เปิดต้องตั้งใจจริง
 *
 * แก้ค่าพวกนี้ = แก้เพดานส่วนลดของทั้งร้าน จึงต้องอยู่ในโหมดผู้จัดการ
 * ส่วนการอ่านปล่อยผ่าน เพราะหน้าเก็บเงินต้องรู้ว่าเพดานเท่าไร
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
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const settings = await updatePartnerSettings(userId, parsed.data);
  await logManager(userId, "partner_settings_changed", parsed.data);
  return NextResponse.json({ data: { settings } });
}
