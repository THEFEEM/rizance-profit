import { query } from "@/lib/db";
import {
  computeCostPerUnit,
  computeLineCost,
  computeOverheadPerCup,
  computeSellingPriceExact,
  computeTotalCostPerCup,
  formatSellingPriceDisplay,
  resolveProfitPerCup,
  sumLineCosts,
} from "@/lib/pricing-math";
import { sumDecimals } from "@/lib/money";
import type {
  Ingredient,
  MenuItem,
  Overhead,
  OverheadCategory,
  PricingSettings,
  PricingSummary,
  PricingSummaryRow,
  PurchaseUnit,
  RecipeLine,
} from "@/types/pricing";
import { OVERHEAD_CATEGORIES } from "@/types/pricing";
import type { ingredientSchema, menuItemSchema, overheadSchema, pricingSettingsSchema, recipeSchema } from "@/lib/pricing-validation";
import type { z } from "zod";

type IngredientInput = z.infer<typeof ingredientSchema>;
type MenuItemInput = z.infer<typeof menuItemSchema>;
type OverheadInput = z.infer<typeof overheadSchema>;
type SettingsInput = z.infer<typeof pricingSettingsSchema>;
type RecipeInput = z.infer<typeof recipeSchema>;

// ---- mappers --------------------------------------------------------------

type IngredientRow = {
  id: string;
  name: string;
  purchase_quantity: string;
  purchase_unit: string;
  purchase_price: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapIngredient(r: IngredientRow): Ingredient {
  return {
    id: r.id,
    name: r.name,
    purchaseQuantity: r.purchase_quantity,
    purchaseUnit: r.purchase_unit as PurchaseUnit,
    purchasePrice: r.purchase_price,
    costPerUnit: computeCostPerUnit(r.purchase_price, r.purchase_quantity),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

type MenuItemRow = {
  id: string;
  name: string;
  desired_profit: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapMenuItem(r: MenuItemRow, ingredientCostPerCup: string): MenuItem {
  return {
    id: r.id,
    name: r.name,
    desiredProfit: r.desired_profit,
    isActive: r.is_active,
    ingredientCostPerCup,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

type OverheadRow = {
  id: string;
  category: string;
  label: string | null;
  monthly_amount: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapOverhead(r: OverheadRow): Overhead {
  return {
    id: r.id,
    category: r.category as OverheadCategory,
    label: r.label,
    monthlyAmount: r.monthly_amount,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// ---- ingredients ----------------------------------------------------------

export async function listIngredients(userId: string): Promise<Ingredient[]> {
  const { rows } = await query<IngredientRow>(
    `SELECT id, name, purchase_quantity, purchase_unit, purchase_price, created_at, updated_at
     FROM ingredients WHERE user_id = $1 ORDER BY name ASC`,
    [userId],
  );
  return rows.map(mapIngredient);
}

export async function getIngredient(userId: string, id: string): Promise<Ingredient | null> {
  const { rows } = await query<IngredientRow>(
    `SELECT id, name, purchase_quantity, purchase_unit, purchase_price, created_at, updated_at
     FROM ingredients WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return rows[0] ? mapIngredient(rows[0]) : null;
}

export async function createIngredient(userId: string, input: IngredientInput): Promise<Ingredient> {
  const { rows } = await query<IngredientRow>(
    `INSERT INTO ingredients (user_id, name, purchase_quantity, purchase_unit, purchase_price)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, purchase_quantity, purchase_unit, purchase_price, created_at, updated_at`,
    [userId, input.name, input.purchaseQuantity, input.purchaseUnit, input.purchasePrice.toFixed(2)],
  );
  return mapIngredient(rows[0]);
}

export async function updateIngredient(
  userId: string,
  id: string,
  input: Partial<IngredientInput>,
): Promise<Ingredient | null> {
  const existing = await getIngredient(userId, id);
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const purchaseQuantity = input.purchaseQuantity ?? Number(existing.purchaseQuantity);
  const purchaseUnit = input.purchaseUnit ?? existing.purchaseUnit;
  const purchasePrice = input.purchasePrice ?? Number(existing.purchasePrice);
  const { rows } = await query<IngredientRow>(
    `UPDATE ingredients SET name = $3, purchase_quantity = $4, purchase_unit = $5,
      purchase_price = $6, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING id, name, purchase_quantity, purchase_unit, purchase_price, created_at, updated_at`,
    [userId, id, name, purchaseQuantity, purchaseUnit, purchasePrice.toFixed(2)],
  );
  return rows[0] ? mapIngredient(rows[0]) : null;
}

export async function findMenuItemsUsingIngredient(
  userId: string,
  ingredientId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await query<{ id: string; name: string }>(
    `SELECT DISTINCT m.id, m.name
     FROM recipe_items ri
     JOIN menu_items m ON m.id = ri.menu_item_id
     WHERE m.user_id = $1 AND ri.ingredient_id = $2
     ORDER BY m.name`,
    [userId, ingredientId],
  );
  return rows;
}

export async function deleteIngredient(
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; menuItems: { id: string; name: string }[] }> {
  const used = await findMenuItemsUsingIngredient(userId, id);
  if (used.length > 0) return { ok: false, menuItems: used };
  const { rowCount } = await query(`DELETE FROM ingredients WHERE user_id = $1 AND id = $2`, [userId, id]);
  return rowCount ? { ok: true } : { ok: false, menuItems: [] };
}

// ---- menu items & recipes -------------------------------------------------

async function computeMenuItemIngredientCost(userId: string, menuItemId: string): Promise<string> {
  const { rows } = await query<{ quantity: string; purchase_price: string; purchase_quantity: string }>(
    `SELECT ri.quantity, i.purchase_price, i.purchase_quantity
     FROM recipe_items ri
     JOIN ingredients i ON i.id = ri.ingredient_id
     JOIN menu_items m ON m.id = ri.menu_item_id
     WHERE m.user_id = $1 AND ri.menu_item_id = $2`,
    [userId, menuItemId],
  );
  const lines = rows.map((r) =>
    computeLineCost(r.quantity, computeCostPerUnit(r.purchase_price, r.purchase_quantity)),
  );
  return sumLineCosts(...lines, 0);
}

export async function listMenuItems(userId: string): Promise<MenuItem[]> {
  const { rows } = await query<MenuItemRow>(
    `SELECT id, name, desired_profit, is_active, created_at, updated_at
     FROM menu_items WHERE user_id = $1 AND is_active = true ORDER BY name ASC`,
    [userId],
  );
  return Promise.all(
    rows.map(async (r) => mapMenuItem(r, await computeMenuItemIngredientCost(userId, r.id))),
  );
}

export async function getMenuItem(userId: string, id: string): Promise<MenuItem | null> {
  const { rows } = await query<MenuItemRow>(
    `SELECT id, name, desired_profit, is_active, created_at, updated_at
     FROM menu_items WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (!rows[0]) return null;
  return mapMenuItem(rows[0], await computeMenuItemIngredientCost(userId, id));
}

export async function createMenuItem(userId: string, input: MenuItemInput): Promise<MenuItem> {
  const { rows } = await query<MenuItemRow>(
    `INSERT INTO menu_items (user_id, name, desired_profit)
     VALUES ($1, $2, $3)
     RETURNING id, name, desired_profit, is_active, created_at, updated_at`,
    [userId, input.name, input.desiredProfit?.toFixed(2) ?? null],
  );
  return mapMenuItem(rows[0], "0.00");
}

export async function updateMenuItem(
  userId: string,
  id: string,
  input: Partial<MenuItemInput>,
): Promise<MenuItem | null> {
  const existing = await getMenuItem(userId, id);
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const desiredProfit =
    input.desiredProfit !== undefined
      ? input.desiredProfit === null
        ? null
        : input.desiredProfit.toFixed(2)
      : existing.desiredProfit;
  const { rows } = await query<MenuItemRow>(
    `UPDATE menu_items SET name = $3, desired_profit = $4, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING id, name, desired_profit, is_active, created_at, updated_at`,
    [userId, id, name, desiredProfit],
  );
  if (!rows[0]) return null;
  return mapMenuItem(rows[0], await computeMenuItemIngredientCost(userId, id));
}

export async function deleteMenuItem(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM menu_items WHERE user_id = $1 AND id = $2`, [userId, id]);
  return (rowCount ?? 0) > 0;
}

export async function getRecipe(userId: string, menuItemId: string): Promise<RecipeLine[]> {
  const { rows } = await query<{
    id: string;
    ingredient_id: string;
    ingredient_name: string;
    purchase_unit: string;
    quantity: string;
    purchase_price: string;
    purchase_quantity: string;
  }>(
    `SELECT ri.id, ri.ingredient_id, i.name AS ingredient_name, i.purchase_unit,
            ri.quantity, i.purchase_price, i.purchase_quantity
     FROM recipe_items ri
     JOIN ingredients i ON i.id = ri.ingredient_id
     JOIN menu_items m ON m.id = ri.menu_item_id
     WHERE m.user_id = $1 AND ri.menu_item_id = $2
     ORDER BY i.name`,
    [userId, menuItemId],
  );
  return rows.map((r) => {
    const costPerUnit = computeCostPerUnit(r.purchase_price, r.purchase_quantity);
    return {
      id: r.id,
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      purchaseUnit: r.purchase_unit as PurchaseUnit,
      quantity: r.quantity,
      costPerUnit,
      lineCost: computeLineCost(r.quantity, costPerUnit),
    };
  });
}

export async function replaceRecipe(userId: string, menuItemId: string, input: RecipeInput): Promise<RecipeLine[]> {
  const menu = await getMenuItem(userId, menuItemId);
  if (!menu) throw new Error("Menu item not found");
  await query(`DELETE FROM recipe_items WHERE menu_item_id = $1`, [menuItemId]);
  for (const item of input.items) {
    const ing = await getIngredient(userId, item.ingredientId);
    if (!ing) throw new Error("Ingredient not found");
    await query(
      `INSERT INTO recipe_items (menu_item_id, ingredient_id, quantity) VALUES ($1, $2, $3)`,
      [menuItemId, item.ingredientId, item.quantity],
    );
  }
  return getRecipe(userId, menuItemId);
}

// ---- overheads & settings -------------------------------------------------

const FIXED_OVERHEAD_CATEGORIES = OVERHEAD_CATEGORIES.filter((c) => c !== "other");

export async function ensureDefaultOverheads(userId: string): Promise<void> {
  for (const category of FIXED_OVERHEAD_CATEGORIES) {
    await query(
      `INSERT INTO overheads (user_id, category, monthly_amount)
       SELECT $1, $2, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM overheads WHERE user_id = $1 AND category = $2
       )`,
      [userId, category],
    );
  }
}

export async function listOverheads(userId: string): Promise<{ items: Overhead[]; monthlyTotal: string }> {
  await ensureDefaultOverheads(userId);
  const { rows } = await query<OverheadRow>(
    `SELECT id, category, label, monthly_amount, created_at, updated_at
     FROM overheads WHERE user_id = $1
     ORDER BY CASE category
       WHEN 'rent' THEN 1 WHEN 'electricity' THEN 2 WHEN 'water' THEN 3
       WHEN 'internet' THEN 4 WHEN 'wages' THEN 5 ELSE 6 END, label NULLS LAST`,
    [userId],
  );
  const items = rows.map(mapOverhead);
  return { items, monthlyTotal: sumDecimals(...items.map((o) => o.monthlyAmount), 0) };
}

export async function createOverhead(userId: string, input: OverheadInput): Promise<Overhead> {
  if (input.category !== "other") {
    const { rows } = await query<OverheadRow>(
      `UPDATE overheads SET monthly_amount = $3, updated_at = now()
       WHERE user_id = $1 AND category = $2
       RETURNING id, category, label, monthly_amount, created_at, updated_at`,
      [userId, input.category, input.monthlyAmount.toFixed(2)],
    );
    if (rows[0]) return mapOverhead(rows[0]);
  }
  const { rows } = await query<OverheadRow>(
    `INSERT INTO overheads (user_id, category, label, monthly_amount)
     VALUES ($1, $2, $3, $4)
     RETURNING id, category, label, monthly_amount, created_at, updated_at`,
    [userId, input.category, input.label ?? null, input.monthlyAmount.toFixed(2)],
  );
  return mapOverhead(rows[0]);
}

export async function updateOverhead(
  userId: string,
  id: string,
  input: { label?: string | null; monthlyAmount?: number },
): Promise<Overhead | null> {
  const { rows: existing } = await query<OverheadRow>(
    `SELECT id, category, label, monthly_amount, created_at, updated_at
     FROM overheads WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (!existing[0]) return null;
  const label = input.label !== undefined ? input.label : existing[0].label;
  const monthlyAmount =
    input.monthlyAmount !== undefined ? input.monthlyAmount.toFixed(2) : existing[0].monthly_amount;
  const { rows } = await query<OverheadRow>(
    `UPDATE overheads SET label = $3, monthly_amount = $4, updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING id, category, label, monthly_amount, created_at, updated_at`,
    [userId, id, label, monthlyAmount],
  );
  return rows[0] ? mapOverhead(rows[0]) : null;
}

export async function deleteOverhead(userId: string, id: string): Promise<boolean> {
  const { rows } = await query<{ category: string }>(
    `SELECT category FROM overheads WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (!rows[0] || rows[0].category !== "other") return false;
  const { rowCount } = await query(`DELETE FROM overheads WHERE user_id = $1 AND id = $2`, [userId, id]);
  return (rowCount ?? 0) > 0;
}

export async function getPricingSettings(userId: string): Promise<PricingSettings> {
  const { rows } = await query<{
    estimated_cups_per_month: number;
    default_profit_per_cup: string | null;
    updated_at: Date | string;
  }>(
    `SELECT estimated_cups_per_month, default_profit_per_cup, updated_at
     FROM pricing_settings WHERE user_id = $1`,
    [userId],
  );
  if (rows[0]) {
    return {
      estimatedCupsPerMonth: rows[0].estimated_cups_per_month,
      defaultProfitPerCup: rows[0].default_profit_per_cup,
      updatedAt: toIso(rows[0].updated_at),
    };
  }
  return { estimatedCupsPerMonth: 0, defaultProfitPerCup: null, updatedAt: new Date().toISOString() };
}

export async function upsertPricingSettings(userId: string, input: SettingsInput): Promise<PricingSettings> {
  const defaultProfit =
    input.defaultProfitPerCup === undefined
      ? null
      : input.defaultProfitPerCup === null
        ? null
        : input.defaultProfitPerCup.toFixed(2);
  const { rows } = await query<{
    estimated_cups_per_month: number;
    default_profit_per_cup: string | null;
    updated_at: Date | string;
  }>(
    `INSERT INTO pricing_settings (user_id, estimated_cups_per_month, default_profit_per_cup)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       estimated_cups_per_month = EXCLUDED.estimated_cups_per_month,
       default_profit_per_cup = EXCLUDED.default_profit_per_cup,
       updated_at = now()
     RETURNING estimated_cups_per_month, default_profit_per_cup, updated_at`,
    [userId, input.estimatedCupsPerMonth, defaultProfit],
  );
  return {
    estimatedCupsPerMonth: rows[0].estimated_cups_per_month,
    defaultProfitPerCup: rows[0].default_profit_per_cup,
    updatedAt: toIso(rows[0].updated_at),
  };
}

// ---- pricing summary (computed) -------------------------------------------

export async function getPricingSummary(userId: string): Promise<PricingSummary> {
  const [settings, { monthlyTotal }, menuItems] = await Promise.all([
    getPricingSettings(userId),
    listOverheads(userId),
    listMenuItems(userId),
  ]);
  const overheadPerCup = computeOverheadPerCup(monthlyTotal, settings.estimatedCupsPerMonth);

  const rows: PricingSummaryRow[] = menuItems.map((m) => {
    const totalCost = computeTotalCostPerCup(m.ingredientCostPerCup, overheadPerCup);
    const profit = resolveProfitPerCup(m.desiredProfit, settings.defaultProfitPerCup);
    const sellingExact = computeSellingPriceExact(totalCost, profit);
    return {
      menuItemId: m.id,
      menuName: m.name,
      ingredientCostPerCup: m.ingredientCostPerCup,
      overheadPerCup: overheadPerCup ?? "0.00",
      totalCostPerCup: totalCost,
      profitPerCup: profit,
      sellingPriceExact: sellingExact,
      sellingPriceDisplay: formatSellingPriceDisplay(sellingExact),
    };
  });

  return {
    settings,
    monthlyOverheadTotal: monthlyTotal,
    overheadPerCup,
    rows,
  };
}
