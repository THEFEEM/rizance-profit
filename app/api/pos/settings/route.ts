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

  const settings = await upsertPosShopSettings(userId, parsed.data);
  return NextResponse.json({ data: settings });
}
