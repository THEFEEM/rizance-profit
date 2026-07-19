import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPosDailySummary } from "@/lib/pos-summary-queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/pos/summary?date=YYYY-MM-DD — daily dashboard aggregates. */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    return posErrorResponse("invalid_date", 400);
  }

  const summary = await getPosDailySummary(userId, date);
  return NextResponse.json({ data: summary });
}
