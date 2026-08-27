import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { createProductionRecipe, listProductionRecipes } from "@/lib/production-queries";
import { productionErrorResponse, readJson } from "@/lib/production-http";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * GET  /api/pos/production/recipes        — สูตรผลิตทั้งหมด (?active=1)
 * POST /api/pos/production/recipes        — สร้างสูตรใหม่
 *
 * ทั้งสองต้องอยู่ในโหมดผู้จัดการ — สูตรผลิตเปิดเผยต้นทุนวัตถุดิบ
 * และการแก้สูตรกระทบต้นทุนซอสทุกใบที่ผลิตต่อจากนี้
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const activeOnly = new URL(req.url).searchParams.get("active") === "1";
  return NextResponse.json({
    data: { recipes: await listProductionRecipes(userId, activeOnly) },
  });
}

const bodySchema = z.object({
  outputIngredientId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  batchPrefix: z.string().trim().min(1).max(8).optional(),
  expectedOutputQty: z.number().positive().max(1_000_000),
  note: z.string().trim().max(255).nullish(),
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(60),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // วัตถุดิบซ้ำในสูตรเดียวกันไม่ได้ (PK คู่จะปฏิเสธอยู่แล้ว แต่บอกให้ชัดกว่า)
  const ids = parsed.data.items.map((i) => i.ingredientId);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "duplicate_ingredient" }, { status: 400 });
  }

  try {
    const recipe = await createProductionRecipe(userId, parsed.data);
    await logManager(userId, "production_recipe_created", { recipeId: recipe.id });
    return NextResponse.json({ data: { recipe } }, { status: 201 });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
