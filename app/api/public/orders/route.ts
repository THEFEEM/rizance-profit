import { NextRequest, NextResponse } from "next/server";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import {
  PosOrderProductError,
  createPublicOrder,
  getShopByMenuToken,
} from "@/lib/pos-order-queries";
import {
  PosInvalidModifierError,
  PosModifierRuleError,
} from "@/lib/pos-modifier-queries";
import { publicOrderSchema } from "@/lib/pos-validation";

/** POST /api/public/orders — customer places a pre-order (no auth). */
export async function POST(req: NextRequest) {
  const retryIn = authRateLimitExceeded(`order:${clientIp(req)}`);
  if (retryIn !== null) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = publicOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const shop = await getShopByMenuToken(parsed.data.token);
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!shop.onlineOrderingEnabled) {
    return NextResponse.json({ error: "ordering_disabled" }, { status: 403 });
  }

  try {
    const { token: _token, ...input } = parsed.data;
    const result = await createPublicOrder(shop.userId, input);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof PosOrderProductError) {
      return NextResponse.json({ error: "invalid_product" }, { status: 400 });
    }
    if (err instanceof PosInvalidModifierError) {
      return NextResponse.json({ error: "invalid_modifier" }, { status: 400 });
    }
    if (err instanceof PosModifierRuleError) {
      return NextResponse.json({ error: "modifier_required" }, { status: 400 });
    }
    throw err;
  }
}
