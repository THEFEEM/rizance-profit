import { NextRequest, NextResponse } from "next/server";
import { publicVoucherRateLimitExceeded } from "@/lib/rate-limit";
import { isVoucherToken } from "@/lib/pos-voucher-token";
import { getPublicVoucherCard } from "@/lib/pos-voucher-queries";

/**
 * GET /api/public/voucher/:token — ข้อมูลสำหรับการ์ดดิจิทัล (ไม่มี session)
 *
 * ⚠️ คืนเฉพาะสิ่งที่พิมพ์บนการ์ดได้: แบรนด์ ชื่อแคมเปญ มูลค่า public_code สถานะ วันหมดอายุ
 *    ไม่มี id ภายใน / token_hash / member / metadata / ชื่อพนักงาน
 * ทุกกรณีที่ไม่ผ่าน = 404 เหมือนกันหมด (ไม่บอกว่า token ผิดรูปหรือไม่มีจริง)
 * สถานะคำนวณสดจาก DB ทุกครั้ง — screenshot การ์ดเก่าจึงไม่มีความหมาย
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const retry = publicVoucherRateLimitExceeded(req);
  if (retry !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" } },
    );
  }
  const { token } = await params;
  const notFound = () =>
    NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!isVoucherToken(token)) return notFound();

  const card = await getPublicVoucherCard(token);
  if (!card) return notFound();
  return NextResponse.json({ data: { card } }, { headers: { "Cache-Control": "no-store" } });
}
