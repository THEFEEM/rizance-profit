import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { listPosOrders } from "@/lib/pos-order-queries";

/** GET /api/pos/orders?active=1 — staff order queue. */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const activeOnly = req.nextUrl.searchParams.get("active") === "1";
  const orders = await listPosOrders(userId, { activeOnly });
  return NextResponse.json({ data: { orders } });
}
