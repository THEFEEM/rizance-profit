import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPosFeedback } from "@/lib/pos-feedback-queries";

/** GET /api/pos/feedback?limit=20 — เสียงจากลูกค้า (เฉลี่ย + รายการล่าสุด) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitParam) ? limitParam : 20;

  const data = await getPosFeedback(userId, limit);
  return NextResponse.json({ data });
}
