import { NextRequest, NextResponse } from "next/server";
import { getOrderByAccessToken } from "@/lib/pos-order-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/public/orders/:accessToken — customer order status. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const order = await getOrderByAccessToken(token);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Strip staff-only linkage before returning to the customer.
  const { billId: _billId, ...safe } = order;
  return NextResponse.json({ data: safe });
}
