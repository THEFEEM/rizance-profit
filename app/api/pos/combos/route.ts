import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosComboInvalidProductError,
  listPosCombos,
  upsertPosCombo,
} from "@/lib/pos-combo-queries";

const comboSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(120),
  ),
  description: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(300))
    .nullable()
    .optional(),
  comboPrice: z
    .number()
    .finite()
    .gt(0)
    .max(999_999.99)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: "ราคามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง",
    }),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().finite().gt(0).max(99),
      }),
    )
    .min(1, "คอมโบต้องมีสินค้าอย่างน้อย 1 รายการ")
    .max(10),
});

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const combos = await listPosCombos(userId, { includeInactive });
  return NextResponse.json({ data: { combos } });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = comboSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  // สินค้าซ้ำในคอมโบเดียวกัน → ให้ใช้ quantity แทน (unique index กันอยู่แล้ว แต่ตอบให้ชัดกว่า)
  const ids = parsed.data.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) {
    return posErrorResponse("duplicate_product", 400);
  }

  try {
    const combo = await upsertPosCombo(userId, parsed.data);
    return NextResponse.json({ data: { combo } }, { status: 201 });
  } catch (err) {
    if (err instanceof PosComboInvalidProductError) {
      return posErrorResponse("invalid_product", 400);
    }
    throw err;
  }
}

export { comboSchema };
