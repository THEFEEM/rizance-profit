import { NextRequest, NextResponse } from "next/server";
import { periodRange } from "@/lib/date";
import { getUserId } from "@/lib/session";
import { createTransfer, listTransfersInPeriod } from "@/lib/queries";
import { fieldErrorsFrom, transferSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const transfer = await createTransfer(userId, parsed.data);
  return NextResponse.json({ data: transfer }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { start, end } = periodRange("last_30");
  const data = await listTransfersInPeriod(userId, start, end);
  return NextResponse.json({ data });
}
