import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { splitProfit } from "@/lib/booth-queries";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;
  const data = await splitProfit(userId, id);
  if (!data) {
    return NextResponse.json({ error: { message: "ไม่พบงานบูธนี้" } }, { status: 404 });
  }

  return NextResponse.json({ data });
}
