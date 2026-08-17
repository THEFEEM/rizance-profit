import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { campaignSchema } from "@/lib/pos-campaign-schema";
import { createPosCampaign, listPosCampaigns } from "@/lib/pos-campaign-queries";
import { displayStatus } from "@/lib/pos-campaign-engine";

/** Ninenon Campaigns — CRUD (staff เท่านั้น · public ไม่มีทางเห็น endpoint นี้) */


export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeArchived = req.nextUrl.searchParams.get("archived") === "1";
  const campaigns = await listPosCampaigns(userId, { includeArchived });
  return NextResponse.json({
    data: {
      campaigns: campaigns.map((c) => ({ ...c, displayStatus: displayStatus(c) })),
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", data: { issues: parsed.error.issues.slice(0, 3) } },
      { status: 400 },
    );
  }

  try {
    const campaign = await createPosCampaign(userId, parsed.data);
    return NextResponse.json({ data: { campaign } }, { status: 201 });
  } catch (err) {
    // 23505 บน idx_pos_campaigns_user_code = โค้ดคูปองซ้ำ
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}
