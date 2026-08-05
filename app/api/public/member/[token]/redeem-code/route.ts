import { NextResponse } from "next/server";
import {
  PosNotEnoughPointsError,
  createRedeemCode,
  getPosMemberByToken,
} from "@/lib/pos-member-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/member/[token]/redeem-code
 * ลูกค้ากด "แลกรางวัล" บนบัตร → ได้โค้ดใช้ครั้งเดียว อายุ 5 นาที
 *
 * ⚠️ ไม่ตัดแต้มที่นี่ — แต้มหักตอน POS สแกนสำเร็จเท่านั้น
 *    ลูกค้าจึงไม่มีทางลดแต้มตัวเองหรือแลกรางวัลได้โดยไม่ผ่านร้าน
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const found = await getPosMemberByToken(token);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const code = await createRedeemCode(found.userId, found.member.id);
    return NextResponse.json({ data: code }, { status: 201 });
  } catch (err) {
    if (err instanceof PosNotEnoughPointsError) {
      return NextResponse.json(
        { error: "not_enough_points", data: { points: err.points } },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "points_disabled") {
      return NextResponse.json({ error: "points_disabled" }, { status: 400 });
    }
    if (err instanceof Error && err.message === "member_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
