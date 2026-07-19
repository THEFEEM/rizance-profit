import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPosRangeSummary } from "@/lib/pos-summary-queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * GET /api/pos/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Back-compat: ?date=YYYY-MM-DD → start = end = date.
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const date = req.nextUrl.searchParams.get("date");
  const start = req.nextUrl.searchParams.get("start") ?? date;
  const end = req.nextUrl.searchParams.get("end") ?? date;

  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return posErrorResponse("invalid_date", 400);
  }
  if (start > end) {
    return posErrorResponse("invalid_range", 400);
  }
  const spanMs = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (spanMs / 86_400_000 + 1 > MAX_RANGE_DAYS) {
    return posErrorResponse("range_too_large", 400);
  }

  const summary = await getPosRangeSummary(userId, start, end);
  return NextResponse.json({ data: summary });
}
