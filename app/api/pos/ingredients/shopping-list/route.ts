import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getShoppingList } from "@/lib/pos-ingredient-queries";

/**
 * GET /api/pos/ingredients/shopping-list?days=14 — ต้องซื้ออะไร เท่าไหร่
 *
 * ═══ Policy (10 ก.ย. 2569) ═══════════════════════════════════════════
 * staff-safe: ลิสต์ต้องซื้อ · การใช้/วันที่เหลือ · ของผลิตเองที่ควรผลิต — พนักงานดูได้
 * owner-sensitive: `productionDemand` มีสัดส่วนสูตรผลิต (input × ปริมาณต่อ batch)
 *   → ส่งเฉพาะเมื่อปลดล็อกผู้จัดการอยู่ · ล็อกอยู่ได้ [] (ไม่ 403 — หน้าเดียวกันใช้ทั้งสองสถานะ)
 *   ตัวเลข productionShortfall บน item ยังส่ง (เป็นปริมาณซื้อ ไม่เปิดเผยสูตร)
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 14);
  const days = Number.isFinite(daysParam) ? daysParam : 14;

  const [result, gate] = await Promise.all([
    getShoppingList(userId, days),
    requireManagerUnlock(req, userId),
  ]);
  const unlocked = gate === null;

  return NextResponse.json({
    data: unlocked ? result : { ...result, productionDemand: [] },
  });
}
