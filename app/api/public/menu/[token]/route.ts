import { NextRequest, NextResponse } from "next/server";
import { getShopByMenuToken } from "@/lib/pos-order-queries";
import { listPosCatalog } from "@/lib/pos-queries";
import { listPosCombos } from "@/lib/pos-combo-queries";
import { pool } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/public/menu/:token — customer-facing menu (no auth, no costs). */
export async function GET(
  req: NextRequest,
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

  // โต๊ะ (0075): ยืนยัน ?t= ฝั่ง server — client รู้แค่ผลว่าจริง/ไม่จริง
  let table: { code: string; label: string } | null = null;
  const t = req.nextUrl.searchParams.get("t");
  if (t && /^[A-Za-z0-9]{1,10}$/.test(t)) {
    const { rows } = await pool.query<{ code: string; label: string }>(
      `SELECT code, label FROM pos_tables
       WHERE user_id = $1 AND upper(code) = upper($2) AND is_active = true`,
      [shop.userId, t],
    );
    table = rows[0] ?? null;
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
        table,
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
