import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { businessDate } from "@/lib/date";
import { centsToDecimalString, toCents } from "@/lib/money";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import {
  INGREDIENT_RETURN,
  PosIngredientNotFoundError,
  applyReceiveLine,
  type IngredientRow,
} from "@/lib/pos-ingredient-queries";

/**
 * การผลิตวัตถุดิบเอง — ซอสโฮมเมด / ซอสชีส (0089)
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) ไม่มีระบบสต็อกชุดที่สอง — ซอสเป็นแถวใน ingredients เหมือนของอื่น
 *    ตอนผลิตเสร็จเรียก applyReceiveLine() ตัวเดียวกับที่รับของใช้
 *    → ได้ค่าเฉลี่ยถ่วงน้ำหนักเดิม trigger 0076 เดิม ไม่ต้องเขียนใหม่
 * 2) ต้นทุนใช้ผลผลิต "จริง" ไม่ใช่ที่คาดไว้ — ของเสียดันต้นทุนขึ้นตามจริง
 * 3) ปิดใบผลิต = transaction เดียว สำเร็จหมดหรือไม่เกิดอะไรเลย
 * 4) ไม่ลงรายจ่ายใหม่ — ค่าวัตถุดิบถูกลงเป็นรายจ่ายตอนซื้อไปแล้ว
 *    การผลิตคือการย้ายมูลค่าจากวัตถุดิบไปเป็นซอส ไม่ใช่ค่าใช้จ่ายใหม่
 * 5) วัตถุดิบไม่พอ = ปิดใบไม่ได้ การผลิตเป็นการตัดสินใจ ต้องรู้ก่อนลงมือ
 *
 * ═══ หน่วย ═══════════════════════════════════════════════════
 *   production_recipe_items.quantity = หน่วยใช้งาน (กรัม/มล./ชิ้น)
 *   production_batch_items.*_qty     = หน่วยสต็อก (แปลงแล้ว)
 *   แปลงด้วย fn_recipe_qty_in_purchase_unit() จาก 0088
 *   → ตัวเดียวกับที่ trigger คิดต้นทุนเมนูใช้ ไม่มีสูตรแปลงหน่วยตัวที่สอง
 */

// ═══ errors ════════════════════════════════════════════════════

export class ProductionRecipeNotFoundError extends Error {
  constructor() {
    super("production_recipe_not_found");
    this.name = "ProductionRecipeNotFoundError";
  }
}
export class ProductionBatchNotFoundError extends Error {
  constructor() {
    super("production_batch_not_found");
    this.name = "ProductionBatchNotFoundError";
  }
}
export class ProductionBatchNotDraftError extends Error {
  constructor(public status: string) {
    super("production_batch_not_draft");
    this.name = "ProductionBatchNotDraftError";
  }
}
export class ProductionOutputNotProducedError extends Error {
  constructor() {
    super("production_output_not_produced_kind");
    this.name = "ProductionOutputNotProducedError";
  }
}
export class ProductionRecipeEmptyError extends Error {
  constructor() {
    super("production_recipe_empty");
    this.name = "ProductionRecipeEmptyError";
  }
}
export class ProductionSelfReferenceError extends Error {
  constructor() {
    super("production_recipe_self_reference");
    this.name = "ProductionSelfReferenceError";
  }
}
export class ProductionDuplicateNameError extends Error {
  constructor() {
    super("production_recipe_duplicate_name");
    this.name = "ProductionDuplicateNameError";
  }
}
export class ProductionRecipeExistsError extends Error {
  constructor() {
    super("production_recipe_already_exists");
    this.name = "ProductionRecipeExistsError";
  }
}
/** รหัสสูตรซ้ำในร้านเดียวกัน (0093 · idx_production_recipes_code) */
export class ProductionDuplicateCodeError extends Error {
  constructor() {
    super("production_recipe_duplicate_code");
    this.name = "ProductionDuplicateCodeError";
  }
}

/** วัตถุดิบไม่พอ — บอกครบว่าขาดอะไรเท่าไร เพื่อให้หน้าจอแสดงได้ทันที */
export class InsufficientRawMaterialError extends Error {
  constructor(
    public shortages: {
      ingredientId: string;
      name: string;
      unit: string;
      required: string;
      available: string;
      short: string;
    }[],
  ) {
    super("insufficient_raw_material");
    this.name = "InsufficientRawMaterialError";
  }
}

const isDuplicate = (err: unknown, hint?: string): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e.code !== "23505") return false;
  if (!hint) return true;
  return `${e.constraint ?? ""}${e.detail ?? ""}`.includes(hint);
};

// ═══ types ═════════════════════════════════════════════════════

export type ProductionRecipeItem = {
  ingredientId: string;
  ingredientName: string;
  /** หน่วยสต็อกของวัตถุดิบ */
  unit: string;
  /** ปริมาณในสูตร (หน่วยใช้งาน) */
  quantity: string;
  /** แปลงเป็นหน่วยสต็อกแล้ว */
  stockQty: string;
  /** ต้นทุนต่อหน่วยสต็อกตอนนี้ (null = ยังไม่มีต้นทุน) */
  unitCost: string | null;
  /** ต้นทุนบรรทัดนี้ต่อ 1 รอบการผลิต */
  lineCost: string;
  sortOrder: number;
};

export type ProductionRecipe = {
  id: string;
  outputIngredientId: string;
  outputName: string;
  outputUnit: string;
  name: string;
  /** รหัสสูตรที่คนอ่านออก เช่น PRD-WRAP-SAUCE (0093) — คนละตัวกับ batchPrefix */
  recipeCode: string | null;
  /** คำนำหน้าเลขใบผลิต เช่น WZS → WZS-20260831-001 */
  batchPrefix: string;
  expectedOutputQty: string;
  /** ใช้กี่หน่วยต่อ 1 เมนู (0093) — planning เท่านั้น ไม่ใช่แหล่งตัดสต็อก */
  usagePerPortion: string | null;
  isActive: boolean;
  note: string | null;
  items: ProductionRecipeItem[];
  /** Σ lineCost ต่อ 1 รอบ */
  batchCost: string;
  /** batchCost ÷ expectedOutputQty */
  expectedUnitCost: string;
  /** ผลผลิต ÷ ใช้ต่อเมนู (null = ยังไม่ระบุ usagePerPortion) */
  portionsPerBatch: number | null;
  /** expectedUnitCost × usagePerPortion (null = ยังไม่ระบุ) */
  costPerPortion: string | null;
  /** มีวัตถุดิบที่ยังไม่มีต้นทุนกี่รายการ — UI เตือน "ต้นทุนยังไม่สมบูรณ์" */
  missingCostCount: number;
};

export type ProductionBatchItem = {
  id: string;
  ingredientId: string | null;
  ingredientName: string;
  unit: string;
  plannedQty: string;
  actualQty: string;
  unitCost: string;
  totalCost: string;
  sortOrder: number;
};

export type ProductionBatch = {
  id: string;
  batchNo: string;
  businessDate: string;
  recipeId: string | null;
  recipeName: string;
  outputIngredientId: string;
  outputName: string;
  outputUnit: string;
  multiplier: string;
  expectedOutputQty: string;
  actualOutputQty: string | null;
  totalCost: string | null;
  unitCost: string | null;
  /** ผลผลิตจริง ÷ ที่คาดไว้ × 100 (null = ยังไม่ปิดใบ) */
  yieldPercent: string | null;
  status: "draft" | "completed" | "cancelled";
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  items: ProductionBatchItem[];
};

// ═══ สูตรผลิต ═══════════════════════════════════════════════════

type RecipeRow = {
  id: string;
  output_ingredient_id: string;
  output_name: string;
  output_unit: string;
  name: string;
  recipe_code: string | null;
  batch_prefix: string;
  expected_output_qty: string;
  usage_per_portion: string | null;
  is_active: boolean;
  note: string | null;
};

const RECIPE_SELECT = `
  SELECT r.id, r.output_ingredient_id, i.name AS output_name,
         i.purchase_unit AS output_unit, r.name, r.recipe_code, r.batch_prefix,
         r.expected_output_qty::text AS expected_output_qty,
         r.usage_per_portion::text AS usage_per_portion, r.is_active, r.note
  FROM production_recipes r
  JOIN ingredients i ON i.id = r.output_ingredient_id`;

type RecipeItemRow = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity: string;
  stock_qty: string;
  unit_cost: string | null;
  sort_order: number;
};

/**
 * บรรทัดวัตถุดิบของสูตร + ต้นทุนปัจจุบัน
 * แปลงหน่วยด้วยฟังก์ชันของ 0088 ใน SQL เลย เพื่อให้ตรงกับที่ trigger ใช้เป๊ะ
 */
async function recipeItems(
  db: PoolClient | typeof pool,
  recipeId: string,
): Promise<ProductionRecipeItem[]> {
  const { rows } = await db.query<RecipeItemRow>(
    `SELECT pri.ingredient_id, i.name AS ingredient_name, i.purchase_unit AS unit,
            pri.quantity::text AS quantity,
            fn_recipe_qty_in_purchase_unit(pri.quantity, i.purchase_unit)::text AS stock_qty,
            i.avg_cost::text AS unit_cost,
            pri.sort_order
     FROM production_recipe_items pri
     JOIN ingredients i ON i.id = pri.ingredient_id
     WHERE pri.recipe_id = $1
     ORDER BY pri.sort_order, i.name`,
    [recipeId],
  );
  return rows.map((r) => ({
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredient_name,
    unit: r.unit,
    quantity: r.quantity,
    stockQty: r.stock_qty,
    unitCost: r.unit_cost,
    lineCost: centsToDecimalString(lineCostCents(r.stock_qty, r.unit_cost)),
    sortOrder: r.sort_order,
  }));
}

/** ปริมาณ × ต้นทุนต่อหน่วย → สตางค์ · ปัดครั้งเดียวตอนท้าย */
function lineCostCents(stockQty: string | number, unitCost: string | null): number {
  if (unitCost == null) return 0;
  return Math.round(Number(stockQty) * Number(unitCost) * 100);
}

async function mapRecipe(
  db: PoolClient | typeof pool,
  r: RecipeRow,
): Promise<ProductionRecipe> {
  const items = await recipeItems(db, r.id);
  const batchCostCents = items.reduce((s, it) => s + toCents(it.lineCost), 0);
  const expected = Number(r.expected_output_qty);
  const unitCost = expected > 0 ? batchCostCents / 100 / expected : 0;
  // ใช้ต่อเมนู (0093) — ตัวเลข "ประมาณ" สำหรับวางแผน ไม่ผูกกับการตัดสต็อก
  const usage = r.usage_per_portion == null ? null : Number(r.usage_per_portion);
  return {
    id: r.id,
    outputIngredientId: r.output_ingredient_id,
    outputName: r.output_name,
    outputUnit: r.output_unit,
    name: r.name,
    recipeCode: r.recipe_code,
    batchPrefix: r.batch_prefix,
    expectedOutputQty: r.expected_output_qty,
    usagePerPortion: r.usage_per_portion,
    isActive: r.is_active,
    note: r.note,
    items,
    batchCost: centsToDecimalString(batchCostCents),
    expectedUnitCost: expected > 0 ? unitCost.toFixed(4) : "0.0000",
    portionsPerBatch:
      usage != null && usage > 0 && expected > 0 ? Math.floor(expected / usage) : null,
    costPerPortion: usage != null && usage > 0 ? (unitCost * usage).toFixed(2) : null,
    // ต้นทุนไม่ครบ ≠ สูตรผิด — บันทึกได้ แต่ต้องบอกให้เห็น (ห้ามโชว์ ฿0 เงียบ ๆ)
    // นับทั้ง NULL และ 0: ของที่ยังไม่เคยซื้อเข้าระบบ avg_cost เป็น 0 ไม่ใช่ NULL
    missingCostCount: items.filter(
      (it) => it.unitCost == null || Number(it.unitCost) <= 0,
    ).length,
  };
}

export async function listProductionRecipes(
  userId: string,
  activeOnly = false,
): Promise<ProductionRecipe[]> {
  const { rows } = await pool.query<RecipeRow>(
    `${RECIPE_SELECT}
     WHERE r.user_id = $1 ${activeOnly ? "AND r.is_active" : ""}
     ORDER BY r.is_active DESC, r.name ASC`,
    [userId],
  );
  return Promise.all(rows.map((r) => mapRecipe(pool, r)));
}

export async function getProductionRecipe(
  userId: string,
  recipeId: string,
): Promise<ProductionRecipe | null> {
  const { rows } = await pool.query<RecipeRow>(
    `${RECIPE_SELECT} WHERE r.user_id = $1 AND r.id = $2`,
    [userId, recipeId],
  );
  return rows[0] ? mapRecipe(pool, rows[0]) : null;
}

/** สูตรที่ใช้งานอยู่ของซอสตัวนี้ (มีได้สูตรเดียว — partial unique ใน 0089) */
export async function activeRecipeFor(
  userId: string,
  outputIngredientId: string,
): Promise<ProductionRecipe | null> {
  const { rows } = await pool.query<RecipeRow>(
    `${RECIPE_SELECT}
     WHERE r.user_id = $1 AND r.output_ingredient_id = $2 AND r.is_active`,
    [userId, outputIngredientId],
  );
  return rows[0] ? mapRecipe(pool, rows[0]) : null;
}

export type RecipeInput = {
  outputIngredientId: string;
  name: string;
  /** รหัสสูตร (0093) — ไม่ส่ง = ไม่มีรหัส (สูตรเก่าใช้งานได้ปกติ) */
  recipeCode?: string | null;
  batchPrefix?: string;
  expectedOutputQty: number;
  /** ใช้ต่อเมนู (0093) — planning เท่านั้น */
  usagePerPortion?: number | null;
  note?: string | null;
  items: { ingredientId: string; quantity: number }[];
};

/**
 * สร้างสูตร — ตัวผลผลิตต้องเป็น kind='produced' เท่านั้น
 * ไม่งั้นจะเกิดเรื่องแปลก: ของที่ซื้อมาแต่มีสูตรผลิต แล้วเข้าสต็อกได้ 2 ทาง
 */
export async function createProductionRecipe(
  userId: string,
  input: RecipeInput,
): Promise<ProductionRecipe> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: out } = await client.query<{ kind: string }>(
      `SELECT kind FROM ingredients WHERE id = $2 AND user_id = $1`,
      [userId, input.outputIngredientId],
    );
    if (!out[0]) throw new PosIngredientNotFoundError();
    if (out[0].kind !== "produced") throw new ProductionOutputNotProducedError();
    if (input.items.length === 0) throw new ProductionRecipeEmptyError();
    if (input.items.some((it) => it.ingredientId === input.outputIngredientId)) {
      throw new ProductionSelfReferenceError();
    }

    let recipeId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO production_recipes
           (user_id, output_ingredient_id, name, recipe_code, batch_prefix,
            expected_output_qty, usage_per_portion, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          userId,
          input.outputIngredientId,
          input.name.trim(),
          input.recipeCode?.trim().toUpperCase().slice(0, 32) || null,
          (input.batchPrefix?.trim() || "PRD").toUpperCase().slice(0, 8),
          input.expectedOutputQty,
          input.usagePerPortion != null && input.usagePerPortion > 0
            ? input.usagePerPortion
            : null,
          input.note?.trim() || null,
        ],
      );
      recipeId = rows[0].id;
    } catch (err) {
      // สองเคสนี้ทั้งคู่เป็น 23505 แต่ผู้ใช้ต้องเห็นข้อความต่างกัน
      if (isDuplicate(err, "active_output")) throw new ProductionRecipeExistsError();
      if (isDuplicate(err, "recipes_code")) throw new ProductionDuplicateCodeError();
      if (isDuplicate(err)) throw new ProductionDuplicateNameError();
      throw err;
    }

    await insertRecipeItems(client, recipeId, input.items);

    const { rows: fresh } = await client.query<RecipeRow>(
      `${RECIPE_SELECT} WHERE r.id = $1`,
      [recipeId],
    );
    const result = await mapRecipe(client, fresh[0]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertRecipeItems(
  client: PoolClient,
  recipeId: string,
  items: { ingredientId: string; quantity: number }[],
): Promise<void> {
  let sort = 0;
  for (const it of items) {
    if (it.quantity <= 0) continue;
    await client.query(
      `INSERT INTO production_recipe_items (recipe_id, ingredient_id, quantity, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (recipe_id, ingredient_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, sort_order = EXCLUDED.sort_order`,
      [recipeId, it.ingredientId, it.quantity, sort],
    );
    sort += 1;
  }
}

/**
 * แก้สูตร — เปลี่ยนได้ทุกอย่างยกเว้นตัวผลผลิต
 *
 * ⚠️ แก้สูตรวันนี้ไม่แตะใบผลิตเมื่อวาน เพราะใบผลิต snapshot ทุกอย่างไว้แล้ว
 *    (บังคับด้วยการที่ production_batch_items ไม่ join สูตรเลย)
 */
export async function updateProductionRecipe(
  userId: string,
  recipeId: string,
  input: {
    name?: string;
    recipeCode?: string | null;
    batchPrefix?: string;
    expectedOutputQty?: number;
    usagePerPortion?: number | null;
    note?: string | null;
    isActive?: boolean;
    items?: { ingredientId: string; quantity: number }[];
  },
): Promise<ProductionRecipe | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: own } = await client.query<{ output_ingredient_id: string }>(
      `SELECT output_ingredient_id FROM production_recipes
       WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, recipeId],
    );
    if (!own[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    if (input.items) {
      if (input.items.length === 0) throw new ProductionRecipeEmptyError();
      if (input.items.some((it) => it.ingredientId === own[0].output_ingredient_id)) {
        throw new ProductionSelfReferenceError();
      }
    }

    try {
      await client.query(
        // recipe_code / usage_per_portion ใช้ pattern CASE WHEN sent
        // เพราะต้องแยก "ไม่ส่งมา" (คงเดิม) ออกจาก "ส่ง null" (ล้างค่า)
        `UPDATE production_recipes SET
           name                = COALESCE($3, name),
           batch_prefix        = COALESCE($4, batch_prefix),
           expected_output_qty = COALESCE($5, expected_output_qty),
           note                = CASE WHEN $6::boolean THEN $7 ELSE note END,
           is_active           = COALESCE($8, is_active),
           recipe_code         = CASE WHEN $9::boolean THEN $10 ELSE recipe_code END,
           usage_per_portion   = CASE WHEN $11::boolean THEN $12 ELSE usage_per_portion END,
           updated_at          = now()
         WHERE id = $2 AND user_id = $1`,
        [
          userId,
          recipeId,
          input.name?.trim() || null,
          input.batchPrefix?.trim().toUpperCase().slice(0, 8) || null,
          input.expectedOutputQty ?? null,
          input.note !== undefined,
          input.note?.trim() || null,
          input.isActive ?? null,
          input.recipeCode !== undefined,
          input.recipeCode?.trim().toUpperCase().slice(0, 32) || null,
          input.usagePerPortion !== undefined,
          input.usagePerPortion != null && input.usagePerPortion > 0
            ? input.usagePerPortion
            : null,
        ],
      );
    } catch (err) {
      if (isDuplicate(err, "active_output")) throw new ProductionRecipeExistsError();
      if (isDuplicate(err, "recipes_code")) throw new ProductionDuplicateCodeError();
      if (isDuplicate(err)) throw new ProductionDuplicateNameError();
      throw err;
    }

    if (input.items) {
      // แทนทั้งชุด — บรรทัดที่หายไปจากสูตรใหม่ต้องหายจริง
      const keep = input.items.filter((it) => it.quantity > 0).map((it) => it.ingredientId);
      await client.query(
        `DELETE FROM production_recipe_items
         WHERE recipe_id = $1 AND NOT (ingredient_id = ANY($2::uuid[]))`,
        [recipeId, keep],
      );
      await insertRecipeItems(client, recipeId, input.items);
    }

    const { rows: fresh } = await client.query<RecipeRow>(
      `${RECIPE_SELECT} WHERE r.id = $1`,
      [recipeId],
    );
    const result = await mapRecipe(client, fresh[0]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ═══ พรีวิวก่อนผลิต ═════════════════════════════════════════════

export type ProductionPreviewLine = ProductionRecipeItem & {
  /** ต้องใช้ทั้งหมด (× multiplier) — หน่วยสต็อก */
  requiredQty: string;
  /** คงเหลือในคลังตอนนี้ */
  availableQty: string;
  /** ขาดเท่าไร ("0" = พอ) */
  shortQty: string;
  enough: boolean;
};

export type ProductionPreview = {
  recipe: Pick<
    ProductionRecipe,
    "id" | "name" | "outputIngredientId" | "outputName" | "outputUnit"
  >;
  multiplier: number;
  expectedOutputQty: string;
  lines: ProductionPreviewLine[];
  totalCost: string;
  expectedUnitCost: string;
  canProduce: boolean;
};

/**
 * "ผลิต 2 รอบต้องใช้อะไรบ้าง พอไหม" — อ่านอย่างเดียว ไม่แตะสต็อก
 * ตัวเลขที่ได้ต้องตรงกับตอนปิดใบจริง จึงใช้ query ชุดเดียวกัน
 */
export async function previewProduction(
  userId: string,
  recipeId: string,
  multiplier = 1,
): Promise<ProductionPreview> {
  const recipe = await getProductionRecipe(userId, recipeId);
  if (!recipe) throw new ProductionRecipeNotFoundError();

  const m = Math.max(multiplier, 0);
  const { rows: stock } = await pool.query<{ id: string; stock_qty: string }>(
    `SELECT id, stock_qty::text AS stock_qty FROM ingredients
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, recipe.items.map((it) => it.ingredientId)],
  );
  const byId = new Map(stock.map((r) => [r.id, Number(r.stock_qty)]));

  let totalCents = 0;
  const lines: ProductionPreviewLine[] = recipe.items.map((it) => {
    const required = Number(it.stockQty) * m;
    const available = byId.get(it.ingredientId) ?? 0;
    const short = Math.max(required - available, 0);
    totalCents += lineCostCents(required, it.unitCost);
    return {
      ...it,
      requiredQty: required.toFixed(4),
      availableQty: available.toFixed(4),
      shortQty: short.toFixed(4),
      enough: short <= 0.00005,
    };
  });

  const expectedOut = Number(recipe.expectedOutputQty) * m;
  return {
    recipe: {
      id: recipe.id,
      name: recipe.name,
      outputIngredientId: recipe.outputIngredientId,
      outputName: recipe.outputName,
      outputUnit: recipe.outputUnit,
    },
    multiplier: m,
    expectedOutputQty: expectedOut.toFixed(4),
    lines,
    totalCost: centsToDecimalString(totalCents),
    expectedUnitCost:
      expectedOut > 0 ? (totalCents / 100 / expectedOut).toFixed(4) : "0.0000",
    canProduce: m > 0 && lines.length > 0 && lines.every((l) => l.enough),
  };
}

// ═══ ใบผลิต ═════════════════════════════════════════════════════

type BatchRow = {
  id: string;
  batch_no: string;
  business_date: string;
  recipe_id: string | null;
  recipe_name: string;
  output_ingredient_id: string;
  output_name: string;
  output_unit: string;
  multiplier: string;
  expected_output_qty: string;
  actual_output_qty: string | null;
  total_cost: string | null;
  unit_cost: string | null;
  status: "draft" | "completed" | "cancelled";
  note: string | null;
  completed_at: string | null;
  created_at: string;
};

/** คอลัมน์ที่ส่งออกข้างนอก — ไม่รวม idempotency_key (เป็นข้อมูลภายใน) */
const BATCH_COLS = `id, batch_no, business_date::text AS business_date, recipe_id, recipe_name,
  output_ingredient_id, output_name, output_unit,
  multiplier::text AS multiplier,
  expected_output_qty::text AS expected_output_qty,
  actual_output_qty::text AS actual_output_qty,
  total_cost::text AS total_cost, unit_cost::text AS unit_cost,
  status, note, completed_at::text AS completed_at, created_at::text AS created_at`;

const BATCH_SELECT = `SELECT ${BATCH_COLS} FROM production_batches`;

async function batchItems(
  db: PoolClient | typeof pool,
  batchId: string,
): Promise<ProductionBatchItem[]> {
  const { rows } = await db.query<{
    id: string; ingredient_id: string | null; ingredient_name: string; unit: string;
    planned_qty: string; actual_qty: string; unit_cost_snapshot: string;
    total_cost: string; sort_order: number;
  }>(
    `SELECT id, ingredient_id, ingredient_name, unit,
            planned_qty::float8::text AS planned_qty,
            actual_qty::float8::text AS actual_qty,
            unit_cost_snapshot::text AS unit_cost_snapshot,
            total_cost::text AS total_cost, sort_order
     FROM production_batch_items WHERE batch_id = $1 ORDER BY sort_order, ingredient_name`,
    [batchId],
  );
  return rows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredient_name,
    unit: r.unit,
    plannedQty: r.planned_qty,
    actualQty: r.actual_qty,
    unitCost: r.unit_cost_snapshot,
    totalCost: r.total_cost,
    sortOrder: r.sort_order,
  }));
}

async function mapBatch(
  db: PoolClient | typeof pool,
  r: BatchRow,
): Promise<ProductionBatch> {
  const expected = Number(r.expected_output_qty);
  const actual = r.actual_output_qty == null ? null : Number(r.actual_output_qty);
  return {
    id: r.id,
    batchNo: r.batch_no,
    businessDate: r.business_date,
    recipeId: r.recipe_id,
    recipeName: r.recipe_name,
    outputIngredientId: r.output_ingredient_id,
    outputName: r.output_name,
    outputUnit: r.output_unit,
    multiplier: r.multiplier,
    expectedOutputQty: r.expected_output_qty,
    actualOutputQty: r.actual_output_qty,
    totalCost: r.total_cost,
    unitCost: r.unit_cost,
    yieldPercent:
      actual == null || expected <= 0 ? null : ((actual / expected) * 100).toFixed(2),
    status: r.status,
    note: r.note,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    items: await batchItems(db, r.id),
  };
}

/** เลขใบผลิตถัดไป — HM-20260827-001 (ชนกันแล้วให้ caller retry แบบเดียวกับใบซื้อ) */
async function nextBatchNo(
  client: PoolClient,
  userId: string,
  prefix: string,
  bizDate: string,
): Promise<string> {
  const ymd = bizDate.replace(/-/g, "");
  const { rows } = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX(SUBSTRING(batch_no FROM '[0-9]+$')::int), 0) + 1 AS n
     FROM production_batches
     WHERE user_id = $1 AND batch_no LIKE $2`,
    [userId, `${prefix}-${ymd}-%`],
  );
  return `${prefix}-${ymd}-${String(rows[0].n).padStart(3, "0")}`;
}

/**
 * เปิดใบผลิต (ยังไม่แตะสต็อก) — snapshot ทุกอย่างไว้ตั้งแต่ตอนนี้
 *
 * planned_qty / unit_cost_snapshot เก็บ ณ ตอนเปิดใบ
 * actual_qty เริ่มเท่ากับ planned แล้วผู้จัดการแก้ได้ตอนปิดใบ
 */
export async function createProductionBatch(
  userId: string,
  input: { recipeId: string; multiplier?: number; note?: string | null },
): Promise<ProductionBatch> {
  const m = input.multiplier ?? 1;
  if (!(m > 0)) throw new ProductionRecipeEmptyError();

  const cutoff = await getDayCutoffHour(userId);
  const bizDate = businessDate(cutoff);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: rec } = await client.query<RecipeRow>(
      `${RECIPE_SELECT} WHERE r.user_id = $1 AND r.id = $2`,
      [userId, input.recipeId],
    );
    if (!rec[0]) throw new ProductionRecipeNotFoundError();
    const items = await recipeItems(client, rec[0].id);
    if (items.length === 0) throw new ProductionRecipeEmptyError();

    let batchId = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const batchNo = await nextBatchNo(client, userId, rec[0].batch_prefix, bizDate);
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO production_batches
             (user_id, recipe_id, output_ingredient_id, batch_no, business_date,
              recipe_name, output_name, output_unit, multiplier,
              expected_output_qty, note)
           VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            userId,
            rec[0].id,
            rec[0].output_ingredient_id,
            batchNo,
            bizDate,
            rec[0].name,
            rec[0].output_name,
            rec[0].output_unit,
            m,
            (Number(rec[0].expected_output_qty) * m).toFixed(4),
            input.note?.trim() || null,
          ],
        );
        batchId = rows[0].id;
        break;
      } catch (err) {
        // เลขใบชนกับ request อื่น — วนหาเลขใหม่ (แบบเดียวกับ receivePurchase)
        if (isDuplicate(err, "batch_no")) continue;
        throw err;
      }
    }
    if (!batchId) throw new Error("batch_no_exhausted");

    let sort = 0;
    for (const it of items) {
      const planned = Number(it.stockQty) * m;
      const cents = lineCostCents(planned, it.unitCost);
      await client.query(
        `INSERT INTO production_batch_items
           (batch_id, ingredient_id, ingredient_name, unit,
            planned_qty, actual_qty, unit_cost_snapshot, total_cost, sort_order)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
        [
          batchId,
          it.ingredientId,
          it.ingredientName,
          it.unit,
          planned.toFixed(4),
          Number(it.unitCost ?? 0).toFixed(4),
          centsToDecimalString(cents),
          sort,
        ],
      );
      sort += 1;
    }

    const { rows: fresh } = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE id = $1`,
      [batchId],
    );
    const result = await mapBatch(client, fresh[0]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type CompleteProductionInput = {
  /** ผลผลิตที่ชั่งได้จริง (หน่วยสต็อกของซอส) */
  actualOutputQty: number;
  /** แก้ปริมาณวัตถุดิบที่ใช้จริง (ไม่ส่ง = ใช้ตามที่ snapshot ไว้) */
  actualInputs?: { ingredientId: string; actualQty: number }[];
  note?: string | null;
  /** กดยืนยันซ้ำด้วยคีย์เดิม = คืนใบเดิม ไม่ผลิตซ้ำ */
  idempotencyKey?: string | null;
};

/**
 * ปิดใบผลิต — transaction เดียว สำเร็จหมดหรือไม่เกิดอะไรเลย
 *
 * ลำดับ (ล็อกเรียง id เสมอ กัน deadlock):
 *   1. ล็อกใบผลิต → ต้องยัง draft
 *   2. ล็อกวัตถุดิบทุกตัว (เรียง id)
 *   3. ตรวจสต็อกพอทุกตัว — ไม่พอ = โยน ไม่หักอะไรเลย
 *   4. หักวัตถุดิบ + movement 'production_input' (qty_before/after ครบ)
 *   5. รวมต้นทุน = Σ (ปริมาณจริง × ต้นทุน ณ ตอนนี้)
 *   6. เพิ่มซอสเข้าสต็อกผ่าน applyReceiveLine(source='production')
 *      → ค่าเฉลี่ยถ่วงน้ำหนักเดิม + movement 'production_output'
 *      → trigger 0076 อัปเดตต้นทุนเมนูที่ใช้ซอสให้เองทันที
 *   7. ปิดใบ + เขียน actual_qty/ต้นทุนที่ใช้จริงกลับลงบรรทัด
 *
 * idempotency: ใบเดียวกันปิดซ้ำไม่ได้อยู่แล้ว (ข้อ 1) ส่วน idempotencyKey
 * ใช้กันกรณี client ส่งซ้ำแล้ว request แรกยังไม่ commit
 */
export async function completeProductionBatch(
  userId: string,
  batchId: string,
  input: CompleteProductionInput,
): Promise<ProductionBatch> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. จับจองใบด้วย UPDATE เดียว (atomic gate) ──
    //
    // ไม่ใช้ SELECT ... FOR UPDATE แล้วค่อย UPDATE เพราะรูปแบบนั้นถูกต้องเฉพาะ
    // เมื่อ transaction แยกกันจริง ๆ · การจับจองด้วย UPDATE ... WHERE status='draft'
    // เป็นคำสั่งเดียวที่ atomic ในตัวเอง — ใครมาก่อนได้ไป คนที่สองได้ 0 แถว
    // รูปแบบเดียวกับ atomic gate ของ payroll/purchase (WHERE expense_entry_id IS NULL)
    //
    // ตัวเลขจริงเขียนทับตอนท้าย (ขั้น 7) ตอนนี้ใส่ค่าชั่วคราวที่ผ่าน CHECK
    const { rows: claimed } = await client.query<BatchRow & { idempotency_key: string | null }>(
      `UPDATE production_batches
       SET status = 'completed', actual_output_qty = 0, total_cost = 0,
           unit_cost = NULL, completed_at = now(), updated_at = now()
       WHERE id = $2 AND user_id = $1 AND status = 'draft'
       RETURNING ${BATCH_COLS}, idempotency_key`,
      [userId, batchId],
    );

    let bat = claimed;
    if (!claimed[0]) {
      // จับจองไม่ได้ = ใบนี้ไม่ใช่ draft (หรือไม่มี/ไม่ใช่ของร้านนี้)
      const { rows: exist } = await client.query<BatchRow & { idempotency_key: string | null }>(
        `SELECT ${BATCH_COLS}, idempotency_key FROM production_batches
         WHERE id = $2 AND user_id = $1`,
        [userId, batchId],
      );
      if (!exist[0]) throw new ProductionBatchNotFoundError();
      // ปิดไปแล้วด้วยคีย์เดิม = ถือว่าสำเร็จ คืนใบเดิม (กดซ้ำตอนเน็ตกระตุก)
      if (
        exist[0].status === "completed" &&
        input.idempotencyKey &&
        exist[0].idempotency_key === input.idempotencyKey
      ) {
        const same = await mapBatch(client, exist[0]);
        await client.query("COMMIT");
        return same;
      }
      throw new ProductionBatchNotDraftError(exist[0].status);
    }

    const items = await batchItems(client, batchId);
    if (items.length === 0) throw new ProductionRecipeEmptyError();

    const overrides = new Map(
      (input.actualInputs ?? []).map((a) => [a.ingredientId, a.actualQty]),
    );
    const used = items.map((it) => ({
      ...it,
      use: Math.max(overrides.get(it.ingredientId ?? "") ?? Number(it.actualQty), 0),
    }));

    // ── 2. ล็อกวัตถุดิบ (เรียง id กัน deadlock) ──
    const rawIds = [...new Set(used.map((u) => u.ingredientId).filter(Boolean))] as string[];
    const outId = bat[0].output_ingredient_id;
    const lockIds = [...new Set([...rawIds, outId])].sort();
    const { rows: locked } = await client.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients
       WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [userId, lockIds],
    );
    const byId = new Map(locked.map((r) => [r.id, r]));
    if (!byId.get(outId)) throw new PosIngredientNotFoundError();

    // ── 3. ตรวจสต็อกพอทุกตัวก่อนแตะอะไรเลย ──
    const shortages: InsufficientRawMaterialError["shortages"] = [];
    for (const u of used) {
      if (!u.ingredientId || u.use <= 0) continue;
      const row = byId.get(u.ingredientId);
      if (!row) throw new PosIngredientNotFoundError();
      const have = Number(row.stock_qty) || 0;
      if (have + 0.00005 < u.use) {
        shortages.push({
          ingredientId: u.ingredientId,
          name: row.name,
          unit: row.purchase_unit,
          required: u.use.toFixed(4),
          available: have.toFixed(4),
          short: (u.use - have).toFixed(4),
        });
      }
    }
    if (shortages.length > 0) throw new InsufficientRawMaterialError(shortages);

    // ── 4-5. หักวัตถุดิบ + movement + รวมต้นทุน ──
    let totalCents = 0;
    for (const u of used) {
      if (!u.ingredientId) continue;
      const row = byId.get(u.ingredientId)!;
      // ต้นทุน ณ เวลาผลิต — ไม่ใช้ snapshot ตอนเปิดใบ เพราะราคาอาจขยับ
      // ระหว่างเปิดใบกับปิดใบ ต้นทุนต้องเป็นของจริงตอนที่วัตถุดิบถูกใช้
      const unitCost = row.avg_cost == null ? 0 : Number(row.avg_cost);
      const cents = lineCostCents(u.use, String(unitCost));
      totalCents += cents;

      const before = Number(row.stock_qty) || 0;
      const after = before - u.use;

      if (u.use > 0) {
        await client.query(
          `UPDATE ingredients SET stock_qty = stock_qty - $3, updated_at = now()
           WHERE id = $1 AND user_id = $2`,
          [u.ingredientId, userId, u.use.toFixed(4)],
        );
        await client.query(
          `INSERT INTO ingredient_stock_movements
             (user_id, ingredient_id, production_batch_id, movement_type,
              qty_change, qty_before, qty_after, note)
           VALUES ($1,$2,$3,'production_input',$4,$5,$6,$7)`,
          [
            userId,
            u.ingredientId,
            batchId,
            (-u.use).toFixed(4),
            before.toFixed(4),
            after.toFixed(4),
            `ผลิต ${bat[0].output_name} · ${bat[0].batch_no}`,
          ],
        );
      }

      await client.query(
        `UPDATE production_batch_items
         SET actual_qty = $3, unit_cost_snapshot = $4, total_cost = $5
         WHERE batch_id = $1 AND ingredient_id = $2`,
        [
          batchId,
          u.ingredientId,
          u.use.toFixed(4),
          unitCost.toFixed(4),
          centsToDecimalString(cents),
        ],
      );
    }

    // ── 6. ซอสเข้าสต็อก — engine เดิม ไม่มีสูตรค่าเฉลี่ยตัวที่สอง ──
    const actualOut = Math.max(input.actualOutputQty, 0);
    if (actualOut > 0) {
      await applyReceiveLine(client, userId, byId.get(outId)!, {
        qtyIn: actualOut,
        lineCost: totalCents / 100,
        expenseEntryId: null, // ไม่ลงรายจ่าย — ลงตอนซื้อวัตถุดิบไปแล้ว
        purchaseId: null,
        productionBatchId: batchId,
        source: "production",
        note: `ผลิต ${bat[0].batch_no}`,
      });
    }

    // ── 7. เขียนตัวเลขจริงลงใบที่จับจองไว้แล้ว ──
    // ต้นทุนต่อหน่วยใช้ผลผลิต "จริง" — ของเสียดันต้นทุนขึ้นตามความเป็นจริง
    const unitCost = actualOut > 0 ? totalCents / 100 / actualOut : null;
    await client.query(
      `UPDATE production_batches SET
         actual_output_qty = $3,
         total_cost = $4,
         unit_cost = $5,
         note = COALESCE($6, note),
         idempotency_key = COALESCE($7, idempotency_key),
         completed_at = now(),
         updated_at = now()
       WHERE id = $2 AND user_id = $1`,
      [
        userId,
        batchId,
        actualOut.toFixed(4),
        centsToDecimalString(totalCents),
        unitCost == null ? null : unitCost.toFixed(4),
        input.note?.trim() || null,
        input.idempotencyKey?.trim() || null,
      ],
    );

    const { rows: fresh } = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE id = $1`,
      [batchId],
    );
    const result = await mapBatch(client, fresh[0]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** ยกเลิกใบร่าง — ใบที่ปิดแล้วยกเลิกไม่ได้ (สต็อกขยับไปแล้ว) */
export async function cancelProductionBatch(
  userId: string,
  batchId: string,
): Promise<ProductionBatch | null> {
  const { rows } = await pool.query<BatchRow>(
    `UPDATE production_batches SET status = 'cancelled', updated_at = now()
     WHERE id = $2 AND user_id = $1 AND status = 'draft'
     RETURNING ${BATCH_COLS}`,
    [userId, batchId],
  );
  return rows[0] ? mapBatch(pool, rows[0]) : null;
}

// ═══ ประวัติ ════════════════════════════════════════════════════

export async function listProductionBatches(
  userId: string,
  opts: { from?: string; to?: string; outputIngredientId?: string; limit?: number } = {},
): Promise<ProductionBatch[]> {
  const params: (string | number)[] = [userId];
  const where: string[] = ["user_id = $1"];
  if (opts.from) { params.push(opts.from); where.push(`business_date >= $${params.length}::date`); }
  if (opts.to) { params.push(opts.to); where.push(`business_date <= $${params.length}::date`); }
  if (opts.outputIngredientId) {
    params.push(opts.outputIngredientId);
    where.push(`output_ingredient_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  const { rows } = await pool.query<BatchRow>(
    `${BATCH_SELECT} WHERE ${where.join(" AND ")}
     ORDER BY business_date DESC, created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return Promise.all(rows.map((r) => mapBatch(pool, r)));
}

export async function getProductionBatch(
  userId: string,
  batchId: string,
): Promise<ProductionBatch | null> {
  const { rows } = await pool.query<BatchRow>(
    `${BATCH_SELECT} WHERE id = $2 AND user_id = $1`,
    [userId, batchId],
  );
  return rows[0] ? mapBatch(pool, rows[0]) : null;
}
