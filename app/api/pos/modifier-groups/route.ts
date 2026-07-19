import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosModifierGroupNameExistsError,
  createPosModifierGroup,
  listPosModifierGroups,
} from "@/lib/pos-modifier-queries";
import { createPosModifierGroupSchema } from "@/lib/pos-validation";

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const groups = await listPosModifierGroups(userId, { includeInactive });
  return NextResponse.json({ data: { groups } });
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

  const parsed = createPosModifierGroupSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const group = await createPosModifierGroup(userId, parsed.data);
    return NextResponse.json({ data: group }, { status: 201 });
  } catch (err) {
    if (err instanceof PosModifierGroupNameExistsError) {
      return posErrorResponse("group_name_exists", 409);
    }
    throw err;
  }
}
