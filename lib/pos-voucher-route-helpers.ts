import { randomUUID } from "node:crypto";
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

/**
 * pg SQLSTATE → hint ที่ client แปลเป็นภาษาคนได้ (ไม่ใช่ "unknown_error")
 * บอกแค่ "ชนิด" ของปัญหา — ไม่มี SQL / ค่าในแถว / stack
 */
export function pgErrorHint(err: unknown): string {
  const e = err as { code?: string; constraint?: string } | null;
  const code = e?.code ?? "";
  if (code === "23505") {
    if (e?.constraint === "pos_vouchers_user_id_public_code_key") return "public_code_conflict";
    if (e?.constraint === "idx_pos_voucher_campaigns_prefix_live") return "prefix_in_use";
    return "duplicate";
  }
  if (code === "25006") return "db_read_only";
  if (code === "42P01" || code === "42703") return "schema_out_of_date";
  if (code === "57014") return "db_timeout";
  if (code.startsWith("08") || code === "53300" || code === "57P01" || code === "57P03") return "db_unavailable";
  if (code === "23503") return "fk_violation";
  if (code === "23514") return "check_violation";
  if (e && typeof (e as { name?: string }).name === "string" && (e as { name: string }).name.includes("Timeout")) return "db_timeout";
  return "unexpected";
}

/**
 * catch-all ของทุก voucher route — แทน `?? Promise.reject(err)` ที่ทำให้ Next ตอบ 500 ตัวหนังสือล้วน
 * → client ได้ JSON เสมอ: { error: "internal_error", data: { requestId, hint } }
 * log ฝั่ง server แค่ requestId · scope · SQLSTATE · constraint · table — ไม่มี token/hash/ค่าในแถว/stack ให้ client
 */
export function voucherRouteError(err: unknown, scope: string): NextResponse {
  const mapped = voucherErrorResponse(err);
  if (mapped) return mapped;
  const requestId = randomUUID().slice(0, 8);
  const e = err as { code?: string; constraint?: string; table?: string; message?: string; name?: string } | null;
  const hint = pgErrorHint(err);
  console.error(`[voucher:${scope}] ${requestId} hint=${hint} sqlstate=${e?.code ?? "-"} constraint=${e?.constraint ?? "-"} table=${e?.table ?? "-"} name=${e?.name ?? "-"}`);
  return NextResponse.json({ error: "internal_error", data: { requestId, hint } }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}
