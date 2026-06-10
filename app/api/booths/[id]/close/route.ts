import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { closeBooth } from "@/lib/booth-queries";
import { boothCloseErrorResponse } from "@/lib/booth-close-errors";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;
  const result = await closeBooth(userId, id);
  if (!result.ok) {
    const { status, body } = boothCloseErrorResponse(result.reason);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ data: result.booth });
}
