import { NextResponse } from "next/server";
import {
  PosVoucherRejectedError,
  VoucherCampaignImmutableError,
  VoucherCampaignNotFoundError,
  VoucherNotFoundError,
  VoucherStateError,
} from "@/lib/pos-voucher-queries";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/** error class → HTTP · ของร้านอื่น = not_found เสมอ (ไม่เผยว่ามีอยู่) */
export function voucherErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof VoucherCampaignNotFoundError || err instanceof VoucherNotFoundError) {
    return notFound();
  }
  if (err instanceof VoucherCampaignImmutableError) {
    return NextResponse.json(
      { error: "voucher_campaign_immutable", data: { field: err.field } },
      { status: 409 },
    );
  }
  if (err instanceof VoucherStateError) {
    return NextResponse.json({ error: "voucher_state", data: { reason: err.reason } }, { status: 409 });
  }
  if (err instanceof PosVoucherRejectedError) {
    return NextResponse.json(
      { error: "voucher_rejected", data: { reason: err.reason, ...err.info } },
      { status: 409 },
    );
  }
  return null;
}

export async function readJson(req: Request): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}
