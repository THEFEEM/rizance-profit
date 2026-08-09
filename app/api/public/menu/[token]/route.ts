import { NextRequest, NextResponse } from "next/server";
import { getShopByMenuToken } from "@/lib/pos-order-queries";
import { listPosCatalog } from "@/lib/pos-queries";
import { listPosCombos } from "@/lib/pos-combo-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/public/menu/:token — customer-facing menu (no auth, no costs). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const shop = await getShopByMenuToken(token);
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!shop.onlineOrderingEnabled) {
    return NextResponse.json(
      { error: "ordering_disabled", data: { shopName: shop.shopName } },
      { status: 403 },
    );
  }

  const catalog = await listPosCatalog(shop.userId);
  // คอมโบ: ส่งเฉพาะที่ขายได้จริง — ลูกค้าไม่ควรเห็นชุดที่กดแล้ว error
  const combos = (await listPosCombos(shop.userId)).filter((c) => c.sellable);
  return NextResponse.json(
    {
      data: {
        shopName: shop.shopName,
        catalog,
        combos,
        delivery: {
          enabled: shop.deliveryEnabled,
          fee: shop.deliveryFee,
          minOrder: shop.deliveryMinOrder,
          areaNote: shop.deliveryAreaNote,
        },
      },
    },
    { headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" } },
  );
}
