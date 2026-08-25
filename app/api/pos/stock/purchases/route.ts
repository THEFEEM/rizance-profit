import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PurchaseUnitNotFoundError,
  listPurchases,
  receivePurchase,
} from "@/lib/stock-purchase-queries";
import { PosIngredientNotFoundError } from "@/lib/pos-ingredient-queries";
import { z } from "zod";

/**
 * GET  /api/pos/stock/purchases        — ประวัติการซื้อ
 * POST /api/pos/stock/purchases        — รับของเข้าคลัง (1 เอกสาร หลายรายการ)
 *
 * POST ต้องส่ง idempotencyKey เสมอ — ยิงซ้ำด้วย key เดิมคืนเอกสารเดิม
 * ไม่เพิ่มสต็อก ไม่เพิ่มรายจ่าย (ตอบ 200 พร้อม reused: true)
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return NextResponse.json({
    data: { purchases: await listPurchases(userId, Number.isFinite(limit) ? limit : 50) },
  });
}

const lineSchema = z.object({
  ingredientId: z.string().uuid(),
  purchaseQuantity: z.number().positive().max(1_000_000),
  purchaseUnitName: z.string().trim().min(1).max(30).optional(),
  totalPrice: z.number().min(0).max(10_000_000).optional(),
});

const bodySchema = z.object({
  supplierName: z.string().trim().max(120).nullish(),
  invoiceNo: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(255).nullish(),
  paymentMethod: z.enum(["cash", "transfer"]).optional(),
  discount: z.number().min(0).max(10_000_000).optional(),
  lines: z.array(lineSchema).min(1).max(100),
  extraItems: z
    .array(z.object({ label: z.string().trim().min(1).max(80), amount: z.number().min(0) }))
    .max(20)
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(64),
  createdBy: z.string().uuid().nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const result = await receivePurchase(userId, parsed.data);
    return NextResponse.json({ data: result }, { status: result.reused ? 200 : 201 });
  } catch (err) {
    if (err instanceof PosIngredientNotFoundError) {
      return NextResponse.json({ error: "ingredient_not_found" }, { status: 404 });
    }
    if (err instanceof PurchaseUnitNotFoundError) {
      return NextResponse.json({ error: "purchase_unit_not_found" }, { status: 400 });
    }
    throw err;
  }
}
