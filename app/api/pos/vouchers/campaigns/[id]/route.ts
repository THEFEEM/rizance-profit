import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { voucherCampaignSchema, voucherCampaignStatusSchema } from "@/lib/pos-voucher-schema";
import {
  getVoucherCampaign,
  setVoucherCampaignStatus,
  updateVoucherCampaign,
} from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, readJson, voucherRouteError } from "@/lib/pos-voucher-route-helpers";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/pos/vouchers/campaigns/:id */
export async function GET(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  try {
    const campaign = await getVoucherCampaign(userId, id);
    return NextResponse.json({ data: { campaign } });
  } catch (err) {
    return voucherRouteError(err, "campaign");
  }
}

// action-based สำหรับสถานะ · ทั้ง object สำหรับแก้ field (ไม่ partial — ฟอร์มส่งครบเสมอ)
const patchSchema = z.union([voucherCampaignStatusSchema, voucherCampaignSchema]);

/** PATCH /api/pos/vouchers/campaigns/:id */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", data: { issues: parsed.error.issues.slice(0, 3) } },
      { status: 400 },
    );
  }
  try {
    const campaign =
      "status" in parsed.data && Object.keys(parsed.data).length === 1
        ? await setVoucherCampaignStatus(userId, id, parsed.data.status)
        : await updateVoucherCampaign(userId, id, parsed.data as z.infer<typeof voucherCampaignSchema>);
    return NextResponse.json({ data: { campaign } });
  } catch (err) {
    return voucherRouteError(err, "campaign");
  }
}
