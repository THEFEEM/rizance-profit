import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getSourceAnalytics, listVoucherBatches } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

/** GET /api/pos/vouchers/campaigns/:id/batches — batch ทั้งหมด + สถิติ + สรุปตามช่องทางแจก (aggregate ใน SQL) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const [batches, sources] = await Promise.all([listVoucherBatches(userId, id), getSourceAnalytics(userId, id)]);
    return NextResponse.json({ data: { batches, sources } });
  } catch (err) {
    return voucherRouteError(err, "batches");
  }
}
