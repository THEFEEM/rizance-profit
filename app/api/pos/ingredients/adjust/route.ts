import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  posNotFoundResponse,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PosIngredientNotFoundError,
  adjustIngredientStock,
} from "@/lib/pos-ingredient-queries";
import { adjustIngredientSchema } from "@/lib/pos-validation";

/**
 * POST /api/pos/ingredients/adjust — ตรวจนับ/ปรับสต๊อกเป็นจำนวนจริง
 *
 * ═══ Policy (10 ก.ย. 2569 · /stock เป็นหน้า staff) ═══════════════════
 * staff-safe: ตรวจนับเป็นงานประจำวันของพนักงานหน้าร้าน → ไม่ต้องปลดล็อกผู้จัดการ
 * (I-1b เคย gate ไว้ · ถอดออกตามนโยบายใหม่ — เฉพาะ endpoint นี้ ไม่ใช่เหมารวม)
 *
 * สิ่งที่ยังคุมอยู่:
 *   · requirePosSessionAndPlan — ต้องเป็นเซสชันร้าน + แพ็กที่ใช้ POS ได้
 *   · adjustIngredientStock ล็อกแถวด้วย user_id → ข้ามร้านได้ 404 เสมอ
 *   · ทุกครั้งเกิด movement 'adjustment' พร้อมส่วนต่าง → ย้อนดูได้ ไม่หายไปเฉย ๆ
 *   · Data Guard ฝั่ง client เตือน/ให้ยืนยัน 2 ชั้นเมื่อตัวเลขผิดปกติ
 * ⚠️ ไม่มี "ปรับสต็อกด้วยมือ" แยกจาก "ตรวจนับ" — endpoint เดียวกัน (โน้ตไว้ในรายงาน policy)
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = adjustIngredientSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const ingredient = await adjustIngredientStock(
      userId,
      parsed.data.ingredientId,
      parsed.data.actualQty,
      parsed.data.note,
    );
    return NextResponse.json({ data: ingredient });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) return posNotFoundResponse();
    throw err;
  }
}
