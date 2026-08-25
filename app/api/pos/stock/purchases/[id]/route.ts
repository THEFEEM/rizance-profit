import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPurchase } from "@/lib/stock-purchase-queries";

/**
 * GET /api/pos/stock/purchases/:id — รายละเอียดเอกสาร + รายการ
 *
 * ไม่มี PATCH/DELETE โดยตั้งใจ — เอกสารที่รับแล้วเปลี่ยนไม่ได้
 * เพราะสต็อกและรายจ่ายถูกสร้างไปแล้ว ถ้าผิดให้ใช้การตรวจนับแก้
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const found = await getPurchase(userId, id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: found });
}
