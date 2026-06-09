import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { periodSummary } from "@/lib/queries";
import { isValidPeriod } from "@/lib/date";
import type { PeriodKey } from "@/types";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: PeriodKey =
    periodParam && isValidPeriod(periodParam) ? periodParam : "today";

  const data = await periodSummary(userId, period);
  return NextResponse.json({ data });
}
