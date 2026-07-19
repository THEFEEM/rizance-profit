import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosInvalidCategoryError,
  createPosProduct,
  listPosCatalog,
} from "@/lib/pos-queries";
import { setProductModifierGroups } from "@/lib/pos-modifier-queries";
import { createPosProductSchema } from "@/lib/pos-validation";

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const includeCost = req.nextUrl.searchParams.get("includeCost") === "1";
  const catalog = await listPosCatalog(userId, { includeInactive, includeCost });
  return NextResponse.json({ data: catalog });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createPosProductSchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const { modifierGroupIds, ...productInput } = parsed.data;
    const product = await createPosProduct(userId, productInput);
    if (modifierGroupIds !== undefined) {
      const ok = await setProductModifierGroups(userId, product.id, modifierGroupIds);
      if (!ok) return posErrorResponse("invalid_modifier_group", 400);
    }
    return NextResponse.json({ data: product }, { status: 201 });
  } catch (err) {
    if (err instanceof PosInvalidCategoryError) {
      return posErrorResponse("invalid_category", 400);
    }
    throw err;
  }
}
