import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { checkPrefix } from "@/lib/pos-voucher-queries";
import { voucherRouteError } from "@/lib/pos-voucher-route-helpers";

const PREFIX_RE = /^[A-Z0-9]{2,12}$/;

/**
 * GET /api/pos/vouchers/prefix?prefix=RIZANCE — wizard เรียกตอนพิมพ์ prefix (debounce)
 * ตอบ: จองอยู่โดยแคมเปญไหน · เคยออกกี่ใบ · รหัสจะเริ่มเลขไหน (nextSequence) — read-only · scope ร้านตัวเอง
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const prefix = (req.nextUrl.searchParams.get("prefix") ?? "").trim().toUpperCase();
  if (!PREFIX_RE.test(prefix)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const check = await checkPrefix(userId, prefix);
    return NextResponse.json({ data: { check } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return voucherRouteError(err, "prefix.check");
  }
}
