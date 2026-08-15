import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";
import { toCents } from "@/lib/money";
import {
  CampaignNotFoundError,
  validateCampaignForCart,
} from "@/lib/pos-campaign-queries";
import { findPosMemberByPhone } from "@/lib/pos-member-queries";
import type { EngineLine } from "@/lib/pos-campaign-engine";

/**
 * POST /api/pos/campaigns/preview — คำนวณส่วนลด "ก่อน" เก็บเงิน (read-only)
 *
 * POS ส่งตะกร้ามา server คำนวณให้ดูว่าลดเท่าไร/ทำไมไม่ผ่าน
 * ⚠️ ราคาอ่านจาก DB ไม่รับจาก client — client บอกได้แค่ productId + qty
 *    (modifier ยังไม่เข้าฐานส่วนลดใน preview — ตอนปิดบิลจริงคิดครบ ตัวเลขอาจต่างเล็กน้อย
 *     ซึ่ง UI แจ้งว่าเป็น "ประมาณการ")
 */
const previewSchema = z.object({
  campaignId: z.string().uuid().optional(),
  couponCode: z.string().min(1).max(40).optional(),
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(999) }))
    .max(100),
  /** ยอดคอมโบรวม (ส่วนที่ลดไม่ได้ แต่ต้องนับเข้ายอดขั้นต่ำ) */
  comboTotal: z.number().min(0).max(999_999.99).optional(),
  memberPhone: z.string().max(30).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.campaignId && !parsed.data.couponCode)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = parsed.data;

  // ราคาจริงจาก DB
  const lines: EngineLine[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const { rows } = await pool.query<{ sell_price: string }>(
      `SELECT sell_price::text AS sell_price FROM pos_products
       WHERE id = $2 AND user_id = $1`,
      [userId, it.productId],
    );
    if (!rows[0]) continue;
    lines.push({
      index: i,
      productId: it.productId,
      lineTotalCents: toCents(rows[0].sell_price) * it.qty,
      alreadyDiscounted: false,
    });
  }
  // คอมโบ: นับเข้ายอดขั้นต่ำ แต่ลดซ้อนไม่ได้ (index = -1 ไม่ชนของจริง)
  if (input.comboTotal && input.comboTotal > 0) {
    lines.push({
      index: -1,
      productId: null,
      lineTotalCents: toCents(input.comboTotal.toFixed(2)),
      alreadyDiscounted: true,
    });
  }

  let memberId: string | null = null;
  if (input.memberPhone) {
    const m = await findPosMemberByPhone(userId, input.memberPhone).catch(() => null);
    memberId = m?.id ?? null;
  }

  try {
    const { campaign, evaluation } = await validateCampaignForCart({
      userId,
      campaignId: input.campaignId,
      couponCode: input.couponCode,
      lines,
      memberId,
    });
    if (!evaluation.valid) {
      return NextResponse.json({
        data: { valid: false, reason: evaluation.reason, campaignName: campaign.name },
      });
    }
    return NextResponse.json({
      data: {
        valid: true,
        campaignId: campaign.id,
        campaignName: campaign.name,
        discountAmount: evaluation.discountAmount,
        eligibleAmount: evaluation.eligibleAmount,
      },
    });
  } catch (err) {
    if (err instanceof CampaignNotFoundError) {
      return NextResponse.json({ data: { valid: false, reason: "CAMPAIGN_NOT_FOUND" } });
    }
    throw err;
  }
}
