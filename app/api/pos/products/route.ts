import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosInvalidCategoryError,
  createPosProduct,
  listPosCatalog,
} from "@/lib/pos-queries";
import { createPosProductSchema } from "@/lib/pos-validation";

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const catalog = await listPosCatalog(userId);
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
    const product = await createPosProduct(userId, parsed.data);
    return NextResponse.json({ data: product }, { status: 201 });
  } catch (err) {
    if (err instanceof PosInvalidCategoryError) {
      return posErrorResponse("invalid_category", 400);
    }
    throw err;
  }
}
