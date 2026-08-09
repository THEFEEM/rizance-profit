import { NextResponse } from "next/server";
import { getPosMemberByToken } from "@/lib/pos-member-queries";

/**
 * GET /api/public/member/[token] — บัตรสมาชิกฝั่งลูกค้า
 *
 * ไม่มี session: token คือ UUID เดาไม่ได้ต่อคน (แนวเดียวกับ /api/public/orders/[token])
 * ส่งกลับเฉพาะข้อมูลที่ลูกค้าควรเห็น — ไม่มี user_id, ไม่มียอดร้าน, ไม่มีรายการบิลของคนอื่น
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const found = await getPosMemberByToken(token);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    data: {
      shopName: found.shopName,
      rewardNote: found.rewardNote,
      bahtPerPoint: found.bahtPerPoint,
      cardTheme: found.cardTheme,
      redeemPoints: found.redeemPoints,
      publicMenuToken: found.publicMenuToken,
      member: {
        name: found.member.name,
        // ปิดเบอร์กลาง กันคนอื่นเห็นเบอร์เต็มถ้าลูกค้าเปิดจอให้ดู
        phoneMasked: found.member.phone.replace(/^(\d{3})\d{3,4}(\d{3})$/, "$1•••$2"),
        points: found.member.points,
        totalSpent: found.member.totalSpent,
        visitCount: found.member.visitCount,
        lastVisitAt: found.member.lastVisitAt,
        createdAt: found.member.createdAt,
      },
      events: found.events,
    },
  });
}
