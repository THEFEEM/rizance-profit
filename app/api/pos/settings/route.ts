import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPosShopSettings, upsertPosShopSettings } from "@/lib/pos-settings-queries";

/**
 * PromptPay ID:
 *  - mobile: 10 digits starting 0 (e.g. 0812345678)
 *  - citizen id / tax id: 13 digits
 *  - e-wallet id: 15 digits
 */
const promptpayId = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v),
  z
    .string()
    .regex(/^(0\d{9}|\d{13}|\d{15})$/, "invalid promptpay id"),
);

const updateSettingsSchema = z
  .object({
    promptpayId: promptpayId.nullable().optional(),
    receiptHeader: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim() : v),
        z.string().min(1).max(160),
      )
      .nullable()
      .optional(),
    defaultPaymentMethod: z.enum(["cash", "promptpay"]).optional(),
    onlineOrderingEnabled: z.boolean().optional(),
    kitchenEnabled: z.boolean().optional(),
    goLive: z.literal(true).optional(),
    deliveryEnabled: z.boolean().optional(),
    deliveryFee: z.number().finite().gte(0).max(9_999.99).optional(),
    deliveryMinOrder: z.number().finite().gte(0).max(99_999.99).optional(),
    deliveryAreaNote: z
      .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
      .nullable()
      .optional(),
    shopPhone: z
      .preprocess(
        (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v),
        z.string().regex(/^0\d{8,9}$/, "invalid phone"),
      )
      .nullable()
      .optional(),
    defaultPaymentTiming: z.enum(["before", "after"]).optional(),
    /** ตั้ง null = ลบรูป QR ร้าน (แท็บจะหายไปเอง) */
    shopQrUrl: z.string().url().max(1000).nullable().optional(),
    shopQrNote: z
      .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
      .nullable()
      .optional(),
    /** 0 = ตัดวันเที่ยงคืน · 1-11 = ชั่วโมงที่ถือว่าขึ้นวันใหม่ */
    dayCutoffHour: z.number().int().gte(0).lte(11).optional(),
    /** สะสมแต้ม (0068) — แต้มไม่ใช่เงิน ไม่กระทบยอด/บัญชี */
    pointsEnabled: z.boolean().optional(),
    bahtPerPoint: z.number().int().gte(1).lte(1000).optional(),
    rewardNote: z
      .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
      .nullable()
      .optional(),
    /** preset เท่านั้น — ให้เลือกสีอิสระจะได้บัตรที่อ่านไม่ออก */
    cardTheme: z.enum(["ink", "emerald", "sunset", "grape", "ocean", "charcoal"]).optional(),
    /** แต้มที่ต้องมีก่อนบัตรจะขึ้นปุ่มแลกรางวัล */
    redeemPoints: z.number().int().gte(1).lte(100_000).optional(),
    /** Loyalty economy (0071) — คืนลูกค้ากี่ % ของยอดสุทธิ */
    loyaltyReturnPct: z.number().gte(0).lte(20).optional(),
    pointValueSatang: z.number().int().gte(1).lte(10_000).optional(),
    loyaltyUsePct: z.boolean().optional(),
    /** มูลค่ารางวัลเป็นบาท (0072) — ใช้ตรวจว่าตั้งแต้มแลกคืนเกินเป้าไหม */
    rewardValue: z.number().finite().gt(0).max(100_000).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const settings = await getPosShopSettings(userId);
  return NextResponse.json({ data: settings });
}

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  /**
   * ⚠️ กติกาป้องกันตั้งรางวัลที่คืนเกินเป้า (0072)
   *
   *   reward_value ≤ redeem_points × point_value_satang/100
   *
   * ต้องตรวจกับ "ค่าหลังบันทึก" ไม่ใช่แค่ค่าที่ส่งมา — เพราะ admin อาจส่งมาแค่
   * ฟิลด์เดียว (เช่นลด redeem_points อย่างเดียว) แล้วทำให้รางวัลเดิมเกินเป้าทันที
   */
  if (
    parsed.data.rewardValue !== undefined ||
    parsed.data.redeemPoints !== undefined ||
    parsed.data.pointValueSatang !== undefined
  ) {
    const current = await getPosShopSettings(userId);
    const rewardValue =
      parsed.data.rewardValue !== undefined
        ? parsed.data.rewardValue
        : current.rewardValue != null
          ? Number(current.rewardValue)
          : null;
    const points = parsed.data.redeemPoints ?? current.redeemPoints;
    const satang = parsed.data.pointValueSatang ?? current.pointValueSatang;

    if (rewardValue != null) {
      // คำนวณเป็นสตางค์ล้วน กัน floating point ทำให้ ฿65 vs ฿65 ไม่เท่ากัน
      const rewardSatang = Math.round(rewardValue * 100);
      const pointsWorthSatang = points * satang;
      if (rewardSatang > pointsWorthSatang) {
        return NextResponse.json(
          {
            error: "reward_value_exceeds_points",
            data: {
              rewardValue,
              redeemPoints: points,
              pointValueSatang: satang,
              /** แต้มขั้นต่ำที่ต้องตั้งเพื่อไม่ให้คืนเกินเป้า */
              minPointsRequired: Math.ceil(rewardSatang / satang),
            },
          },
          { status: 400 },
        );
      }
    }
  }

  const settings = await upsertPosShopSettings(userId, parsed.data);
  return NextResponse.json({ data: settings });
}
