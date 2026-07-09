import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { PosInvalidCategoryError, updatePosProduct } from "@/lib/pos-queries";
import { updatePosProductSchema } from "@/lib/pos-validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = updatePosProductSchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const product = await updatePosProduct(userId, id, parsed.data);
    if (!product) return posNotFoundResponse();
    return NextResponse.json({ data: product });
  } catch (err) {
    if (err instanceof PosInvalidCategoryError) {
      return posErrorResponse("invalid_category", 400);
    }
    throw err;
  }
}
