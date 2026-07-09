import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { PosCategoryNameExistsError, createPosCategory } from "@/lib/pos-queries";
import { createPosCategorySchema } from "@/lib/pos-validation";

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createPosCategorySchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const category = await createPosCategory(userId, parsed.data);
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (err) {
    if (err instanceof PosCategoryNameExistsError) {
      return posErrorResponse("category_name_exists", 409);
    }
    throw err;
  }
}
