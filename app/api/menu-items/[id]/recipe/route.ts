import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { recipeSchema } from "@/lib/pricing-validation";
import { getRecipe, replaceRecipe } from "@/lib/pricing-queries";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await ctx.params;
  const data = await getRecipe(userId, id);
  return NextResponse.json({ data });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = recipeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  try {
    const data = await replaceRecipe(userId, id, parsed.data);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }
}
