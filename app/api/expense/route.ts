import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { expenseSchema, fieldErrorsFrom } from "@/lib/validation";
import { createExpense, listExpenseByDate } from "@/lib/queries";
import { today, isValidDate } from "@/lib/date";

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = expenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const expense = await createExpense(userId, parsed.data);
  return NextResponse.json({ data: expense }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const date = dateParam && isValidDate(dateParam) ? dateParam : today();
  const data = await listExpenseByDate(userId, date);
  return NextResponse.json({ data });
}
