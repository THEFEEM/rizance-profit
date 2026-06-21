import { NextRequest, NextResponse } from "next/server";
import { findPaymentByChargeId } from "@/lib/payment";
import { getOmise } from "@/lib/omise";
import { getUserId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const chargeId = req.nextUrl.searchParams.get("chargeId")?.trim();
  if (!chargeId) {
    return NextResponse.json({ error: { message: "chargeId is required" } }, { status: 400 });
  }

  const record = await findPaymentByChargeId(userId, chargeId);
  if (!record) {
    return NextResponse.json({ error: { message: "Payment not found" } }, { status: 404 });
  }

  let charge;
  try {
    charge = await getOmise().charges.retrieve(chargeId);
  } catch (err) {
    console.error("[payment/status] Omise error:", err);
    return NextResponse.json(
      { error: { message: "Unable to check payment status." } },
      { status: 502 },
    );
  }

  const paid = charge.paid === true;
  const status = paid ? "paid" : charge.expired ? "expired" : charge.status === "failed" ? "failed" : "pending";

  return NextResponse.json({
    data: {
      chargeId,
      status,
      paid,
      amount: record.amount,
      tier: record.tier,
    },
  });
}
