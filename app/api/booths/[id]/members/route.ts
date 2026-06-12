import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { boothMemberSchema } from "@/lib/booth-validation";
import { boothMemberErrorResponse } from "@/lib/booth-errors";
import { createBoothMember, getBooth, listBoothMembers } from "@/lib/booth-queries";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;
  const booth = await getBooth(userId, id);
  if (!booth) return NextResponse.json({ error: { message: "ไม่พบงานบูธนี้" } }, { status: 404 });

  const data = await listBoothMembers(userId, id);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = boothMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const result = await createBoothMember(userId, id, parsed.data);
  if (!result.ok) {
    const { status, body: errBody } = boothMemberErrorResponse(result.reason);
    return NextResponse.json(errBody, { status });
  }

  return NextResponse.json({ data: result.member }, { status: 201 });
}
