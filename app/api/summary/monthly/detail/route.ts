import { NextRequest, NextResponse } from "next/server";
import { addDays, isValidMonth, monthRange } from "@/lib/date";
import { categoryBreakdown, monthlySummary } from "@/lib/queries";
import { getUserId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  if (!monthParam || !isValidMonth(monthParam)) {
    return NextResponse.json({ error: { message: "Invalid month" } }, { status: 400 });
  }

  const { start, endExclusive } = monthRange(monthParam);
  const end = addDays(endExclusive, -1);

  const [summary, breakdown] = await Promise.all([
    monthlySummary(userId, monthParam),
    categoryBreakdown(userId, start, end),
  ]);

  return NextResponse.json({
    data: {
      month: monthParam,
      income: summary.income,
      expense: summary.expense,
      profit: summary.profit,
      incomeCategories: breakdown.income,
      expenseCategories: breakdown.expense,
    },
  });
}
