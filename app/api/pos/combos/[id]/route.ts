import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosComboInvalidProductError,
  PosComboNotFoundError,
  deletePosCombo,
  getPosCombo,
  upsertPosCombo,
} from "@/lib/pos-combo-queries";
import { comboSchema } from "../route";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await ctx.params;
  const combo = await getPosCombo(userId, id);
  if (!combo) return posErrorResponse("not_found", 404);
  return NextResponse.json({ data: { combo } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = comboSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  const ids = parsed.data.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) return posErrorResponse("duplicate_product", 400);

  try {
    const combo = await upsertPosCombo(userId, parsed.data, id);
    return NextResponse.json({ data: { combo } });
  } catch (err) {
    if (err instanceof PosComboNotFoundError) return posErrorResponse("not_found", 404);
    if (err instanceof PosComboInvalidProductError) {
      return posErrorResponse("invalid_product", 400);
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await ctx.params;
  const ok = await deletePosCombo(userId, id);
  if (!ok) return posErrorResponse("not_found", 404);
  return NextResponse.json({ data: { deleted: true } });
}
