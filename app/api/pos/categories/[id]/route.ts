import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { PosCategoryNameExistsError, updatePosCategory } from "@/lib/pos-queries";
import { updatePosCategorySchema } from "@/lib/pos-validation";

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

  const parsed = updatePosCategorySchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const category = await updatePosCategory(userId, id, parsed.data);
    if (!category) return posNotFoundResponse();
    return NextResponse.json({ data: category });
  } catch (err) {
    if (err instanceof PosCategoryNameExistsError) {
      return posErrorResponse("category_name_exists", 409);
    }
    throw err;
  }
}
