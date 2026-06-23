import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { shopMemberProfitWithdrawable } from "@/lib/shop-profit-withdrawable";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const data = await shopMemberProfitWithdrawable(userId);
  return NextResponse.json({ data });
}
