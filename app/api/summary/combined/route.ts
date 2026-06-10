import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { combinedPeriodSummary } from "@/lib/combined-summary";
import { isValidPeriod } from "@/lib/date";
import type { PeriodKey } from "@/types";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: PeriodKey =
    periodParam && isValidPeriod(periodParam) ? periodParam : "today";

  const data = await combinedPeriodSummary(userId, period);
  return NextResponse.json({ data });
}
