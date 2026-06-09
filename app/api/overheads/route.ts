import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { overheadSchema } from "@/lib/pricing-validation";
import { createOverhead, listOverheads } from "@/lib/pricing-queries";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const data = await listOverheads(userId);
  return NextResponse.json({ data });
}

/** Add a new "other" overhead line. Fixed categories are seeded and updated via PATCH [id]. */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = overheadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }
  if (parsed.data.category !== "other") {
    return NextResponse.json({ error: { message: "Use PATCH to update fixed categories" } }, { status: 400 });
  }

  const data = await createOverhead(userId, parsed.data);
  return NextResponse.json({ data }, { status: 201 });
}
