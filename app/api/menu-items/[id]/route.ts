import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { menuItemSchema } from "@/lib/pricing-validation";
import { deleteMenuItem, getMenuItem, updateMenuItem } from "@/lib/pricing-queries";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await ctx.params;
  const data = await getMenuItem(userId, id);
  if (!data) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = menuItemSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const data = await updateMenuItem(userId, id, parsed.data);
  if (!data) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await ctx.params;
  const ok = await deleteMenuItem(userId, id);
  if (!ok) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  return NextResponse.json({ data: { id } });
}
