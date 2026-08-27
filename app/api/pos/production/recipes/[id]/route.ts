import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  getProductionRecipe,
  previewProduction,
  updateProductionRecipe,
} from "@/lib/production-queries";
import { productionErrorResponse, readJson } from "@/lib/production-http";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * GET   /api/pos/production/recipes/[id]                — รายละเอียดสูตร
 * GET   /api/pos/production/recipes/[id]?multiplier=2   — พรีวิว "ผลิต 2 รอบใช้อะไร พอไหม"
 * PATCH /api/pos/production/recipes/[id]                — แก้สูตร / เปิด-ปิดใช้งาน
 *
 * ⚠️ แก้สูตรวันนี้ไม่แตะใบผลิตเมื่อวาน — ใบผลิต snapshot ทุกอย่างไว้แล้ว
 */

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("multiplier");

  try {
    // มี multiplier = ขอพรีวิว · ไม่มี = ขอตัวสูตร
    if (raw !== null) {
      const m = Number(raw);
      if (!Number.isFinite(m) || m <= 0 || m > 100) {
        return NextResponse.json({ error: "invalid_multiplier" }, { status: 400 });
      }
      return NextResponse.json({ data: await previewProduction(userId, id, m) });
    }
    const recipe = await getProductionRecipe(userId, id);
    if (!recipe) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ data: { recipe } });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  batchPrefix: z.string().trim().min(1).max(8).optional(),
  expectedOutputQty: z.number().positive().max(1_000_000).optional(),
  note: z.string().trim().max(255).nullish(),
  isActive: z.boolean().optional(),
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(60)
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  const { id } = await ctx.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  if (parsed.data.items) {
    const ids = parsed.data.items.map((i) => i.ingredientId);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "duplicate_ingredient" }, { status: 400 });
    }
  }

  try {
    const recipe = await updateProductionRecipe(userId, id, parsed.data);
    if (!recipe) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await logManager(userId, "production_recipe_updated", { recipeId: id });
    return NextResponse.json({ data: { recipe } });
  } catch (err) {
    const mapped = productionErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
