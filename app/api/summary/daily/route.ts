import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { dailySummary } from "@/lib/queries";
import { today, isValidDate } from "@/lib/date";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const date = dateParam && isValidDate(dateParam) ? dateParam : today();
  const data = await dailySummary(userId, date);
  return NextResponse.json({ data });
}
