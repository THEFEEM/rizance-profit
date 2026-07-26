import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getShoppingList } from "@/lib/pos-ingredient-queries";

/** GET /api/pos/ingredients/shopping-list?days=14 — ต้องซื้ออะไร เท่าไหร่ */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 14);
  const days = Number.isFinite(daysParam) ? daysParam : 14;

  const result = await getShoppingList(userId, days);
  return NextResponse.json({ data: result });
}
