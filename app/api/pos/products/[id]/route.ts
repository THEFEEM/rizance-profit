import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { PosInvalidCategoryError, deletePosProduct, updatePosProduct } from "@/lib/pos-queries";
import { setProductModifierGroups } from "@/lib/pos-modifier-queries";
import { updatePosProductSchema } from "@/lib/pos-validation";
import {
  deleteObject,
  isSupabaseStorageConfigured,
  objectPathFromPublicUrl,
  posMenuBucket,
} from "@/lib/supabase-storage";

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
    const { modifierGroupIds, ...productInput } = parsed.data;
    // Empty productInput falls through to the SELECT path in updatePosProduct.
    const product = await updatePosProduct(userId, id, productInput);
    if (!product) return posNotFoundResponse();
    if (modifierGroupIds !== undefined) {
      const ok = await setProductModifierGroups(userId, id, modifierGroupIds);
      if (!ok) return posErrorResponse("invalid_modifier_group", 400);
    }
    return NextResponse.json({ data: product });
  } catch (err) {
    if (err instanceof PosInvalidCategoryError) {
      return posErrorResponse("invalid_category", 400);
    }
    throw err;
  }
}

/** DELETE /api/pos/products/:id — permanent removal (history keeps snapshots). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const deleted = await deletePosProduct(userId, id);
  if (!deleted) return posNotFoundResponse();

  // Best-effort image cleanup — the product row is already gone.
  if (deleted.imageUrl && isSupabaseStorageConfigured()) {
    const path = objectPathFromPublicUrl(posMenuBucket(), deleted.imageUrl);
    if (path) void deleteObject(posMenuBucket(), path).catch(() => undefined);
  }

  return NextResponse.json({ data: { productId: id, deleted: true } });
}
