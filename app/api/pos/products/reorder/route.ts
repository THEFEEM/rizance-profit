import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { reorderPosProducts } from "@/lib/pos-queries";
import { reorderPosProductsSchema } from "@/lib/pos-validation";

/**
 * PATCH /api/pos/products/reorder
 * Body: { order: [{ id, sortOrder }, ...] }
 *
 * Batch-writes sort_order for the sales-screen tile order. Returns only a count —
 * the client refetches the catalog with its own includeInactive/includeCost flags,
 * so this route can't hand the sales screen a catalog shaped for the admin screen.
 */
export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = reorderPosProductsSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  // Duplicate ids would make the UPDATE ... FROM result order-dependent.
  const ids = parsed.data.order.map((o) => o.id);
  if (new Set(ids).size !== ids.length) return posErrorResponse("duplicate_product", 400);

  const updated = await reorderPosProducts(userId, parsed.data.order);
  if (updated !== parsed.data.order.length) {
    // Client list is stale (product deleted elsewhere) — it must refetch, but the
    // rows that did match are already saved, so this is not a rollback case.
    return NextResponse.json(
      {
        error: "stale_product_list",
        data: { updated, expected: parsed.data.order.length },
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: { updated } });
}
