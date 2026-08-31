import { NextResponse } from "next/server";
import { PosIngredientNotFoundError } from "@/lib/pos-ingredient-queries";
import {
  InsufficientRawMaterialError,
  ProductionBatchNotDraftError,
  ProductionBatchNotFoundError,
  ProductionDuplicateCodeError,
  ProductionDuplicateNameError,
  ProductionOutputNotProducedError,
  ProductionRecipeEmptyError,
  ProductionRecipeExistsError,
  ProductionRecipeNotFoundError,
  ProductionSelfReferenceError,
} from "@/lib/production-queries";

/**
 * แปลง error ของ engine ผลิต → HTTP (ที่เดียว ทุก route ใช้ร่วมกัน)
 *
 * "วัตถุดิบไม่พอ" ส่งรายละเอียดกลับไปด้วย เพื่อให้หน้าจอบอกได้ทันทีว่า
 * ขาดอะไรเท่าไร ไม่ต้องให้ผู้ใช้ไปเปิดหน้าคลังเทียบเอง
 */
export function productionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof InsufficientRawMaterialError) {
    return NextResponse.json(
      { error: err.message, shortages: err.shortages },
      { status: 409 },
    );
  }
  if (err instanceof ProductionBatchNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ProductionRecipeNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof PosIngredientNotFoundError) {
    return NextResponse.json({ error: "ingredient_not_found" }, { status: 404 });
  }
  if (
    err instanceof ProductionRecipeExistsError ||
    err instanceof ProductionDuplicateNameError ||
    err instanceof ProductionDuplicateCodeError ||
    err instanceof ProductionBatchNotDraftError
  ) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (
    err instanceof ProductionOutputNotProducedError ||
    err instanceof ProductionRecipeEmptyError ||
    err instanceof ProductionSelfReferenceError
  ) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return null;
}

/** อ่าน body เป็น JSON — ผิดรูปแบบตอบ 400 ไม่ปล่อยให้ throw หลุดออกไป */
export async function readJson(req: Request): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}
