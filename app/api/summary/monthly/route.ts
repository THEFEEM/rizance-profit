import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { monthlySummary } from "@/lib/queries";
import { currentMonth, isValidMonth } from "@/lib/date";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && isValidMonth(monthParam) ? monthParam : currentMonth();
  const data = await monthlySummary(userId, month);
  return NextResponse.json({ data });
}
