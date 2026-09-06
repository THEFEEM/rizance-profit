import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getVoucherCampaignAnalytics } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

/** GET /api/pos/vouchers/campaigns/:id/analytics — aggregate จาก redemptions จริง */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const analytics = await getVoucherCampaignAnalytics(userId, id);
    return NextResponse.json({ data: { analytics } });
  } catch (err) {
    return voucherRouteError(err, "analytics");
  }
}
