import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  CampaignImmutableError,
  CampaignNotFoundError,
  duplicatePosCampaign,
  getCampaignAnalytics,
  getPosCampaign,
  setPosCampaignStatus,
  updatePosCampaign,
} from "@/lib/pos-campaign-queries";
import { displayStatus } from "@/lib/pos-campaign-engine";
import { campaignBaseSchema } from "@/lib/pos-campaign-schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/pos/campaigns/:id — รายละเอียด + analytics ในครั้งเดียว */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const campaign = await getPosCampaign(userId, id);
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const analytics = await getCampaignAnalytics(userId, id);
  return NextResponse.json({
    data: { campaign: { ...campaign, displayStatus: displayStatus(campaign) }, analytics },
  });
}

const patchSchema = z.union([
  // เปลี่ยนสถานะ / duplicate — action-based กันสับสนกับการแก้ field
  z.object({ action: z.enum(["activate", "pause", "archive", "duplicate"]) }),
  campaignBaseSchema.partial(),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    if ("action" in parsed.data) {
      if (parsed.data.action === "duplicate") {
        const campaign = await duplicatePosCampaign(userId, id);
        return NextResponse.json({ data: { campaign } }, { status: 201 });
      }
      const map: Record<"activate" | "pause" | "archive", "active" | "paused" | "archived"> = {
        activate: "active",
        pause: "paused",
        archive: "archived",
      };
      const ok = await setPosCampaignStatus(userId, id, map[parsed.data.action]);
      if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const campaign = await getPosCampaign(userId, id);
      return NextResponse.json({ data: { campaign } });
    }
    const campaign = await updatePosCampaign(userId, id, parsed.data);
    return NextResponse.json({ data: { campaign } });
  } catch (err) {
    if (err instanceof CampaignNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof CampaignImmutableError) {
      // มี usage แล้ว — แก้กติกาส่วนลดไม่ได้ (ประวัติ/analytics จะโกหก)
      return NextResponse.json({ error: "campaign_has_usage" }, { status: 409 });
    }
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}
