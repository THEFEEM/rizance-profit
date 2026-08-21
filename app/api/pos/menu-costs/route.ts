import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getMenuCostDashboard } from "@/lib/pos-menu-cost-queries";

/** GET /api/pos/menu-costs — ต้นทุนเมนูจากสูตร (คำนวณสด · staff เท่านั้น) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const dashboard = await getMenuCostDashboard(userId);
  return NextResponse.json({ data: dashboard });
}
