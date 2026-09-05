import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { pool } from "@/lib/db";
import { toCents } from "@/lib/money";
import type { EngineLine } from "@/lib/pos-campaign-engine";
import {
  PosVoucherRejectedError,
  logVoucherEvent,
  validateVoucherForCart,
} from "@/lib/pos-voucher-queries";
import { voucherValidateSchema } from "@/lib/pos-voucher-schema";
import { readJson } from "@/lib/pos-voucher-route-helpers";

/**
 * POST /api/pos/vouchers/validate — ตรวจ voucher "ก่อน" เก็บเงิน (read-only, ไม่เปลี่ยน state)
 *
 * เหมือน campaigns/preview: POS ส่ง scan + ตะกร้า · ราคาอ่านจาก DB
 * ตอบ 200 เสมอเมื่อตรวจได้ (valid:true/false) — ให้ UI แสดง error state ที่เหมาะ
 * ไม่ผ่านก็ log 'redeem_rejected' ไว้ (audit: ใครเอาใบไหนมายิงซ้ำ)
 */
const schema = voucherValidateSchema.extend({
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(999) }))
    .max(100)
    .default([]),
  comboTotal: z.number().min(0).max(999_999.99).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const input = parsed.data;

  const lines: EngineLine[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const { rows } = await pool.query<{ sell_price: string }>(
      `SELECT sell_price::text AS sell_price FROM pos_products WHERE id = $2 AND user_id = $1`,
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
  if (input.comboTotal && input.comboTotal > 0) {
    lines.push({
      index: -1,
      productId: null,
      lineTotalCents: toCents(input.comboTotal.toFixed(2)),
      alreadyDiscounted: true,
    });
  }
  // ตะกร้าว่าง: ตรวจสถานะใบได้ แต่ส่วนลด = 0 — ใส่บรรทัดหลอกให้ engine ไม่ตอบ NO_ELIGIBLE_ITEMS
  const probeLines: EngineLine[] =
    lines.length > 0 ? lines : [{ index: 0, productId: null, lineTotalCents: 1, alreadyDiscounted: false }];

  try {
    const { voucher, evaluation } = await validateVoucherForCart({
      userId, scan: input.scan, lines: probeLines,
    });
    return NextResponse.json({
      data: {
        valid: true,
        publicCode: voucher.publicCode,
        campaignName: voucher.campaignName,
        value: voucher.value,
        expiresAt: voucher.expiresAt,
        discountAmount: lines.length > 0 ? evaluation.discountAmount : null,
      },
    });
  } catch (err) {
    if (err instanceof PosVoucherRejectedError) {
      void logVoucherEvent(pool, userId, {
        campaignId: err.internal.campaignId, voucherId: err.internal.voucherId,
        actor: "staff", action: "redeem_rejected", detail: { reason: err.reason },
      }).catch(() => undefined);
      return NextResponse.json({ data: { valid: false, reason: err.reason, ...err.info } });
    }
    throw err;
  }
}
