import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { voucherCampaignSchema } from "@/lib/pos-voucher-schema";
import { createVoucherCampaign, listVoucherCampaigns } from "@/lib/pos-voucher-queries";
import { readJson, voucherErrorResponse } from "@/lib/pos-voucher-route-helpers";

/** GET /api/pos/vouchers/campaigns — รายการแคมเปญ + สถิติ (aggregate ใน SQL ไม่โหลดใบ) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const campaigns = await listVoucherCampaigns(userId);
  return NextResponse.json({ data: { campaigns } });
}

/** POST /api/pos/vouchers/campaigns — สร้างแคมเปญ (status=draft) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = voucherCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", data: { issues: parsed.error.issues.slice(0, 3) } },
      { status: 400 },
    );
  }
  try {
    const campaign = await createVoucherCampaign(userId, parsed.data);
    return NextResponse.json({ data: { campaign } }, { status: 201 });
  } catch (err) {
    return voucherErrorResponse(err) ?? Promise.reject(err);
  }
}
