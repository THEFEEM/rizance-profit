import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fieldErrorsFrom } from "@/lib/validation";
import { getTierPlan, isPaidSubscriptionTier, planLabel } from "@/lib/pricing";
import { createPromptPayCharge, insertPendingPaymentRecord, promptPayQrImageUrl } from "@/lib/payment";
import { getUserId } from "@/lib/session";

const bodySchema = z.object({
  tier: z.string().min(1),
  cycle: z.enum(["period", "year"]).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const { tier, cycle = "period" } = parsed.data;
  if (!isPaidSubscriptionTier(tier)) {
    return NextResponse.json({ error: { message: "Invalid subscription tier" } }, { status: 400 });
  }

  let amountTHB: number;
  let periodDays: number;
  try {
    ({ amountTHB, periodDays } = getTierPlan(tier, cycle));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid tier plan";
    return NextResponse.json({ error: { message } }, { status: 400 });
  }

  let charge;
  try {
    charge = await createPromptPayCharge({ userId, tier, amountTHB, periodDays });
  } catch (err) {
    console.error("[payment/create-charge] Omise error:", err);
    return NextResponse.json(
      { error: { message: "Unable to create payment. Please try again." } },
      { status: 502 },
    );
  }

  const qrImageUrl = promptPayQrImageUrl(charge);
  if (!qrImageUrl) {
    console.error("[payment/create-charge] Missing QR in Omise response:", charge.id);
    return NextResponse.json(
      { error: { message: "Payment provider did not return a QR code." } },
      { status: 502 },
    );
  }

  try {
    await insertPendingPaymentRecord({
      userId,
      tier,
      amountTHB,
      periodDays,
      omiseChargeId: charge.id,
    });
  } catch (err) {
    console.error("[payment/create-charge] DB error:", err);
    return NextResponse.json(
      { error: { message: "Payment created but could not be recorded. Contact support." } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      chargeId: charge.id,
      qrImageUrl,
      amount: amountTHB,
      tier,
      periodDays,
      label: planLabel(tier, periodDays),
    },
  });
}
