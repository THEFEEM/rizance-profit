import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { manualRedemptionListQuerySchema } from "@/lib/pos-voucher-schema";
import { listManualRedemptions } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

/** GET /api/pos/vouchers/campaigns/:id/manual-redemptions?rangeId=&page=&pageSize= — code ที่ใช้แล้ว (V2.1) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const sp = req.nextUrl.searchParams;
  const parsed = manualRedemptionListQuerySchema.safeParse({
    rangeId: sp.get("rangeId") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const page = await listManualRedemptions(userId, id, parsed.data);
    return NextResponse.json({ data: page });
  } catch (err) {
    return voucherRouteError(err, "manual-redemptions.list");
  }
}
