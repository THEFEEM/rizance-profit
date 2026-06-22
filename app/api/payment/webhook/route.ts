import { NextRequest, NextResponse } from "next/server";
import { getOmise } from "@/lib/omise";
import { fulfillPaidPaymentRecord, parseChargeIdFromOmiseWebhook } from "@/lib/payment";

/** Omise retries on non-2xx — always return 200 once parsed (even when skipping). */
function ok(): NextResponse {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn("[payment/webhook] invalid JSON body");
    return ok();
  }

  const chargeId = parseChargeIdFromOmiseWebhook(body);
  if (!chargeId) {
    return ok();
  }

  let charge;
  try {
    charge = await getOmise().charges.retrieve(chargeId);
  } catch (err) {
    console.error("[payment/webhook] Omise retrieve failed:", chargeId, err);
    return ok();
  }

  if (charge.paid !== true) {
    return ok();
  }

  try {
    const result = await fulfillPaidPaymentRecord(charge.id);
    if (result === "extended") {
      console.info("[payment/webhook] subscription extended:", charge.id);
    }
  } catch (err) {
    console.error("[payment/webhook] fulfill failed:", charge.id, err);
  }

  return ok();
}
