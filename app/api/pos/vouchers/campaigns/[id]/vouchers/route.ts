import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { voucherListQuerySchema } from "@/lib/pos-voucher-schema";
import { getVoucherCampaign, listVouchers } from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, voucherErrorResponse } from "@/lib/pos-voucher-route-helpers";

/** GET /api/pos/vouchers/campaigns/:id/vouchers?status=&q=&page=&pageSize= — server-side pagination */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const sp = req.nextUrl.searchParams;
  const parsed = voucherListQuerySchema.safeParse({
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
    batchId: sp.get("batchId") ?? undefined,
    source: sp.get("source") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    // ยืนยันว่าแคมเปญเป็นของร้านนี้ก่อน — list ที่ scope ผิดต้องเป็น 404 ไม่ใช่ []
    await getVoucherCampaign(userId, id);
    const page = await listVouchers(userId, id, parsed.data);
    return NextResponse.json({ data: page });
  } catch (err) {
    return voucherErrorResponse(err) ?? Promise.reject(err);
  }
}
