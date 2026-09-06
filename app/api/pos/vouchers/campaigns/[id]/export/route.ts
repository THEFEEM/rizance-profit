import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { exportVouchersCsv, getVoucherCampaign } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

/**
 * GET /api/pos/vouchers/campaigns/:id/export — CSV (BOM + CRLF เหมือน summary/export)
 * ไม่มี raw token ใน CSV — DB ไม่มีให้อยู่แล้ว (สเปก §21)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const camp = await getVoucherCampaign(userId, id);
    const csv = await exportVouchersCsv(userId, id);
    const filename = `vouchers-${camp.codePrefix}.csv`;
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return voucherRouteError(err, "export");
  }
}
