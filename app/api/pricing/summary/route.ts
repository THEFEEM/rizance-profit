import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { getPricingSummary } from "@/lib/pricing-queries";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const data = await getPricingSummary(userId);
  return NextResponse.json({ data });
}
