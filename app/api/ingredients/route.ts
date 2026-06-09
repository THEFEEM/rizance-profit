import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { ingredientSchema } from "@/lib/pricing-validation";
import { createIngredient, listIngredients } from "@/lib/pricing-queries";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const data = await listIngredients(userId);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = ingredientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const data = await createIngredient(userId, parsed.data);
  return NextResponse.json({ data }, { status: 201 });
}
