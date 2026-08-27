import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { centsToDecimalString, toCents } from "@/lib/money";
import { recipeQuantityInPurchaseUnits } from "@/lib/pricing-units";
import type { PurchaseUnit } from "@/types/pricing";

/**
 * POS ingredient stock + recipes (BOM).
 *
 * Units — สองระบบตามโหมด Pricing เดิม:
 *   • recipe quantity  = usage unit (g / ml / piece) — คนกรอก "เนื้อ 60 กรัม"
 *   • stock_qty        = purchase unit (kg / l / piece) — คนซื้อ "เนื้อ 5 กก."
 *   แปลงตอนตัดสต๊อกด้วย recipeQuantityInPurchaseUnits()
 *
 * Money: cost_per_purchase_unit = purchase_price / purchase_quantity
 */

export type PosIngredient = {
  id: string;
  name: string;
  purchaseQuantity: string;
  purchaseUnit: PurchaseUnit;
  purchasePrice: string;
  /** ราคาต่อ 1 หน่วยซื้อ (เช่น ต่อ 1 kg) */
  costPerPurchaseUnit: string;
  trackStock: boolean;
  stockQty: string;
  lowStockThreshold: string | null;
  /** 0085: เป้าหมายสต็อก (null = ไม่ได้ตั้ง) */
  targetStock: string | null;
  /** หมวด (เนื้อ/ขนมปัง/ผัก/ซอส/บรรจุภัณฑ์) — ใช้จัดกลุ่มตอนไปตลาด */
  category: string | null;
  /** ต้นทุนเฉลี่ยถ่วงน้ำหนัก ต่อ 1 หน่วยซื้อ */
  avgCost: string | null;
  /** ราคาต่อ 1 หน่วยซื้อ ครั้งล่าสุดที่ซื้อจริง */
  lastPurchasePrice: string | null;
  lastPurchasedAt: string | null;
  supplierName: string | null;
  /**
   * 0089: ของนี้มาจากไหน
   *   purchased = ซื้อเข้าร้าน (ค่าตั้งต้น)
   *   produced  = ร้านผลิตเอง เช่น ซอสโฮมเมด → เข้าสต็อกผ่านหน้าผลิตเท่านั้น
   * คนละเรื่องกับ category ซึ่งเป็น "หมวดของ" (Mayo ก็อยู่หมวดซอส แต่ซื้อมา)
   */
  kind: IngredientKind;
};

export type IngredientKind = "purchased" | "produced";

export type PosRecipeLine = {
  ingredientId: string;
  ingredientName: string;
  purchaseUnit: PurchaseUnit;
  /** ปริมาณต่อ 1 ชิ้นที่ขาย (usage unit) */
  quantity: string;
  /** ต้นทุนวัตถุดิบบรรทัดนี้ต่อ 1 ชิ้น */
  lineCost: string;
};

/** @internal — เปิดให้ stock-purchase-queries ใช้ ไม่ควรใช้ที่อื่น */
export type IngredientRow = {
  id: string;
  name: string;
  purchase_quantity: string;
  purchase_unit: string;
  purchase_price: string;
  track_stock: boolean;
  stock_qty: string;
  low_stock_threshold: string | null;
  target_stock: string | null;
  category: string | null;
  avg_cost: string | null;
  last_purchase_price: string | null;
  last_purchased_at: Date | string | null;
  supplier_name: string | null;
  kind: IngredientKind;
};

/** @internal — เปิดให้ stock-purchase-queries ใช้ ไม่ควรใช้ที่อื่น */
export const INGREDIENT_RETURN = `id, name, purchase_quantity::text AS purchase_quantity,
  purchase_unit, purchase_price::text AS purchase_price, track_stock,
  stock_qty::text AS stock_qty, low_stock_threshold::text AS low_stock_threshold,
  target_stock::text AS target_stock,
  category, avg_cost::text AS avg_cost,
  last_purchase_price::text AS last_purchase_price, last_purchased_at, supplier_name,
  kind`;

/** ต้นทุนต่อ 1 หน่วยซื้อ (สตางค์-safe, ปัดที่ 4 ตำแหน่งเพื่อความแม่นของสูตร) */
function costPerPurchaseUnit(purchasePrice: string, purchaseQuantity: string): string {
  const qty = Number(purchaseQuantity);
  if (!Number.isFinite(qty) || qty <= 0) return "0.0000";
  return (Number(purchasePrice) / qty).toFixed(4);
}

function mapIngredient(r: IngredientRow): PosIngredient {
  return {
    id: r.id,
    name: r.name,
    purchaseQuantity: r.purchase_quantity,
    purchaseUnit: r.purchase_unit as PurchaseUnit,
    purchasePrice: r.purchase_price,
    costPerPurchaseUnit: costPerPurchaseUnit(r.purchase_price, r.purchase_quantity),
    trackStock: r.track_stock,
    stockQty: r.stock_qty,
    lowStockThreshold: r.low_stock_threshold,
    targetStock: r.target_stock,
    category: r.category,
    avgCost: r.avg_cost,
    lastPurchasePrice: r.last_purchase_price,
    lastPurchasedAt:
      r.last_purchased_at == null
        ? null
        : r.last_purchased_at instanceof Date
          ? r.last_purchased_at.toISOString()
          : String(r.last_purchased_at),
    supplierName: r.supplier_name,
    kind: r.kind ?? "purchased",
  };
}

/**
 * 0089: ของที่ร้านผลิตเองต้องเข้าสต็อกผ่านหน้าผลิตเท่านั้น
 *
 * ถ้าปล่อยให้ "รับของเข้า" เพิ่มสต็อกซอสได้ จะเกิดสองปัญหา:
 *   1) ค่าวัตถุดิบถูกลงเป็นรายจ่ายซ้ำ (ครั้งแรกตอนซื้อ Mayo ครั้งที่สองตอนรับซอส)
 *   2) ต้นทุนซอสต่อกรัมกลายเป็นค่าที่คนกรอกมือ ไม่ใช่ค่าที่คำนวณจากการผลิตจริง
 *
 * บล็อกที่ชั้นนี้ ไม่ใช่ที่ CHECK ของ DB เพราะต้องการข้อความที่ผู้ใช้อ่านรู้เรื่อง
 * และ engine รับของถูกใช้ร่วมกันหลายทาง (รับของ · โหมดไปตลาด · ใบซื้อ)
 */
export class IngredientIsProducedError extends Error {
  constructor(public ingredientName?: string) {
    super("ingredient_is_produced");
    this.name = "IngredientIsProducedError";
  }
}

/** ปฏิเสธถ้าแถวนี้เป็นของที่ผลิตเอง — เรียกหลังล็อกแถวแล้วทุกครั้ง */
export function assertReceivable(row: Pick<IngredientRow, "kind" | "name">): void {
  if (row.kind === "produced") throw new IngredientIsProducedError(row.name);
}

export class PosIngredientNotFoundError extends Error {
  constructor() {
    super("ingredient not found");
    this.name = "PosIngredientNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Master (reuse ตาราง ingredients ของโหมด Pricing)
// ---------------------------------------------------------------------------

export async function listPosIngredients(userId: string): Promise<PosIngredient[]> {
  const { rows } = await pool.query<IngredientRow>(
    `SELECT ${INGREDIENT_RETURN} FROM ingredients
     WHERE user_id = $1
     ORDER BY name ASC`,
    [userId],
  );
  return rows.map(mapIngredient);
}

export type UpsertIngredientInput = {
  name: string;
  purchaseQuantity: number;
  purchaseUnit: PurchaseUnit;
  purchasePrice: number;
  trackStock?: boolean;
  lowStockThreshold?: number | null;
  /** 0085: เป้าหมายสต็อก — null = ใช้การพยากรณ์จากอัตราการใช้ล้วน ๆ */
  targetStock?: number | null;
  category?: string | null;
  supplierName?: string | null;
  /** 0089: purchased (ค่าตั้งต้น) หรือ produced สำหรับของที่ร้านผลิตเอง */
  kind?: IngredientKind;
};

export async function createPosIngredient(
  userId: string,
  input: UpsertIngredientInput,
): Promise<PosIngredient> {
  const seedCost =
    input.purchaseQuantity > 0
      ? (input.purchasePrice / input.purchaseQuantity).toFixed(4)
      : null;
  const { rows } = await pool.query<IngredientRow>(
    `INSERT INTO ingredients
       (user_id, name, purchase_quantity, purchase_unit, purchase_price,
        track_stock, low_stock_threshold, target_stock, category, supplier_name,
        avg_cost, last_purchase_price, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${INGREDIENT_RETURN}`,
    [
      userId,
      input.name,
      input.purchaseQuantity,
      input.purchaseUnit,
      input.purchasePrice.toFixed(2),
      input.trackStock ?? true,
      input.lowStockThreshold ?? null,
      input.targetStock ?? null,
      input.category?.trim() || null,
      input.supplierName?.trim() || null,
      seedCost,
      // ของที่ผลิตเองไม่มี "ราคาซื้อล่าสุด" — ปล่อย null ไว้ ไม่โกหกรายงาน
      (input.kind ?? "purchased") === "produced" ? null : seedCost,
      input.kind ?? "purchased",
    ],
  );
  return mapIngredient(rows[0]);
}

export async function updatePosIngredient(
  userId: string,
  ingredientId: string,
  input: Partial<UpsertIngredientInput>,
): Promise<PosIngredient | null> {
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [userId, ingredientId];
  let idx = 3;

  const push = (col: string, value: string | number | boolean | null) => {
    sets.push(`${col} = $${idx}`);
    params.push(value);
    idx += 1;
  };

  if (input.name !== undefined) push("name", input.name);
  if (input.purchaseQuantity !== undefined) push("purchase_quantity", input.purchaseQuantity);
  if (input.purchaseUnit !== undefined) push("purchase_unit", input.purchaseUnit);
  if (input.purchasePrice !== undefined) push("purchase_price", input.purchasePrice.toFixed(2));
  if (input.trackStock !== undefined) push("track_stock", input.trackStock);
  if (input.lowStockThreshold !== undefined)
    push("low_stock_threshold", input.lowStockThreshold);
  if (input.targetStock !== undefined) push("target_stock", input.targetStock);
  if (input.category !== undefined) push("category", input.category?.trim() || null);
  if (input.supplierName !== undefined)
    push("supplier_name", input.supplierName?.trim() || null);
  if (input.kind !== undefined) push("kind", input.kind);

  if (sets.length === 0) {
    const { rows } = await pool.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients WHERE id = $2 AND user_id = $1`,
      [userId, ingredientId],
    );
    return rows[0] ? mapIngredient(rows[0]) : null;
  }

  sets.push("updated_at = now()");
  const { rows } = await pool.query<IngredientRow>(
    `UPDATE ingredients SET ${sets.join(", ")}
     WHERE id = $2 AND user_id = $1
     RETURNING ${INGREDIENT_RETURN}`,
    params,
  );
  return rows[0] ? mapIngredient(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Recipe (product / modifier → ingredients)
// ---------------------------------------------------------------------------

type RecipeRow = {
  ingredient_id: string;
  name: string;
  purchase_unit: string;
  purchase_price: string;
  purchase_quantity: string;
  quantity: string;
};

function mapRecipeLine(r: RecipeRow): PosRecipeLine {
  const unit = r.purchase_unit as PurchaseUnit;
  const inPurchaseUnits = recipeQuantityInPurchaseUnits(r.quantity, unit);
  const perUnit = Number(costPerPurchaseUnit(r.purchase_price, r.purchase_quantity));
  return {
    ingredientId: r.ingredient_id,
    ingredientName: r.name,
    purchaseUnit: unit,
    quantity: r.quantity,
    lineCost: (inPurchaseUnits * perUnit).toFixed(4),
  };
}

/** สูตรของสินค้าทั้งหมดของร้าน → product_id → lines */
export async function listProductRecipes(
  userId: string,
): Promise<Map<string, PosRecipeLine[]>> {
  const { rows } = await pool.query<RecipeRow & { product_id: string }>(
    `SELECT pi.product_id, pi.ingredient_id, i.name, i.purchase_unit,
            i.purchase_price::text AS purchase_price,
            i.purchase_quantity::text AS purchase_quantity,
            pi.quantity::text AS quantity
     FROM pos_product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     JOIN pos_products p ON p.id = pi.product_id
     WHERE p.user_id = $1
     ORDER BY i.name ASC`,
    [userId],
  );
  const map = new Map<string, PosRecipeLine[]>();
  for (const r of rows) {
    const arr = map.get(r.product_id) ?? [];
    arr.push(mapRecipeLine(r));
    map.set(r.product_id, arr);
  }
  return map;
}

export async function listModifierRecipes(
  userId: string,
): Promise<Map<string, PosRecipeLine[]>> {
  const { rows } = await pool.query<RecipeRow & { modifier_id: string }>(
    `SELECT mi.modifier_id, mi.ingredient_id, i.name, i.purchase_unit,
            i.purchase_price::text AS purchase_price,
            i.purchase_quantity::text AS purchase_quantity,
            mi.quantity::text AS quantity
     FROM pos_modifier_ingredients mi
     JOIN ingredients i ON i.id = mi.ingredient_id
     JOIN pos_modifiers m ON m.id = mi.modifier_id
     JOIN pos_modifier_groups g ON g.id = m.group_id
     WHERE g.user_id = $1
     ORDER BY i.name ASC`,
    [userId],
  );
  const map = new Map<string, PosRecipeLine[]>();
  for (const r of rows) {
    const arr = map.get(r.modifier_id) ?? [];
    arr.push(mapRecipeLine(r));
    map.set(r.modifier_id, arr);
  }
  return map;
}

/** แทนที่สูตรของสินค้าทั้งชุด (ownership ตรวจทั้งสินค้าและวัตถุดิบ) */
export async function setProductRecipe(
  userId: string,
  productId: string,
  lines: { ingredientId: string; quantity: number }[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: owned } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pos_products WHERE id = $1 AND user_id = $2) AS ok`,
      [productId, userId],
    );
    if (!owned[0]?.ok) {
      await client.query("ROLLBACK");
      return false;
    }

    if (lines.length > 0) {
      const ids = [...new Set(lines.map((l) => l.ingredientId))];
      const { rows: cnt } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ingredients
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, ids],
      );
      if (parseInt(cnt[0].n, 10) !== ids.length) {
        await client.query("ROLLBACK");
        return false;
      }
    }

    await client.query(`DELETE FROM pos_product_ingredients WHERE product_id = $1`, [productId]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO pos_product_ingredients (product_id, ingredient_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [productId, l.ingredientId, l.quantity],
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setModifierRecipe(
  userId: string,
  modifierId: string,
  lines: { ingredientId: string; quantity: number }[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: owned } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pos_modifiers m
         JOIN pos_modifier_groups g ON g.id = m.group_id
         WHERE m.id = $1 AND g.user_id = $2
       ) AS ok`,
      [modifierId, userId],
    );
    if (!owned[0]?.ok) {
      await client.query("ROLLBACK");
      return false;
    }

    if (lines.length > 0) {
      const ids = [...new Set(lines.map((l) => l.ingredientId))];
      const { rows: cnt } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ingredients
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, ids],
      );
      if (parseInt(cnt[0].n, 10) !== ids.length) {
        await client.query("ROLLBACK");
        return false;
      }
    }

    await client.query(`DELETE FROM pos_modifier_ingredients WHERE modifier_id = $1`, [
      modifierId,
    ]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO pos_modifier_ingredients (modifier_id, ingredient_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (modifier_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [modifierId, l.ingredientId, l.quantity],
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Stock deduction / restore — เรียกจากใน transaction ของ closeBill / void
// ---------------------------------------------------------------------------

export type SoldLineForStock = {
  productId: string;
  qty: number;
  modifierIds: string[];
};

/**
 * รวมปริมาณวัตถุดิบที่ต้องตัด (หน่วยซื้อ) จากสูตรสินค้า + สูตรของ modifier ที่เลือก
 * คืน Map<ingredientId, qtyInPurchaseUnits>
 */
async function resolveIngredientUsage(
  client: PoolClient,
  userId: string,
  lines: SoldLineForStock[],
): Promise<Map<string, number>> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const modifierIds = [...new Set(lines.flatMap((l) => l.modifierIds))];

  const [{ rows: productRecipes }, { rows: modifierRecipes }] = await Promise.all([
    productIds.length
      ? client.query<{
          product_id: string;
          ingredient_id: string;
          quantity: string;
          purchase_unit: string;
        }>(
          `SELECT pi.product_id, pi.ingredient_id, pi.quantity::text AS quantity, i.purchase_unit
           FROM pos_product_ingredients pi
           JOIN ingredients i ON i.id = pi.ingredient_id
           WHERE i.user_id = $1 AND i.track_stock = true
             AND pi.product_id = ANY($2::uuid[])`,
          [userId, productIds],
        )
      : Promise.resolve({ rows: [] as never[] }),
    modifierIds.length
      ? client.query<{
          modifier_id: string;
          ingredient_id: string;
          quantity: string;
          purchase_unit: string;
        }>(
          `SELECT mi.modifier_id, mi.ingredient_id, mi.quantity::text AS quantity, i.purchase_unit
           FROM pos_modifier_ingredients mi
           JOIN ingredients i ON i.id = mi.ingredient_id
           WHERE i.user_id = $1 AND i.track_stock = true
             AND mi.modifier_id = ANY($2::uuid[])`,
          [userId, modifierIds],
        )
      : Promise.resolve({ rows: [] as never[] }),
  ]);

  const byProduct = new Map<string, typeof productRecipes>();
  for (const r of productRecipes) {
    const arr = byProduct.get(r.product_id) ?? [];
    arr.push(r);
    byProduct.set(r.product_id, arr);
  }
  const byModifier = new Map<string, typeof modifierRecipes>();
  for (const r of modifierRecipes) {
    const arr = byModifier.get(r.modifier_id) ?? [];
    arr.push(r);
    byModifier.set(r.modifier_id, arr);
  }

  const usage = new Map<string, number>();
  const add = (ingredientId: string, amount: number) => {
    usage.set(ingredientId, (usage.get(ingredientId) ?? 0) + amount);
  };

  for (const line of lines) {
    for (const r of byProduct.get(line.productId) ?? []) {
      const perUnit = recipeQuantityInPurchaseUnits(r.quantity, r.purchase_unit as PurchaseUnit);
      add(r.ingredient_id, perUnit * line.qty);
    }
    for (const modifierId of line.modifierIds) {
      for (const r of byModifier.get(modifierId) ?? []) {
        const perUnit = recipeQuantityInPurchaseUnits(
          r.quantity,
          r.purchase_unit as PurchaseUnit,
        );
        add(r.ingredient_id, perUnit * line.qty);
      }
    }
  }

  return usage;
}

/** ตัดสต๊อกวัตถุดิบตามสูตร + ลง movement (เรียกใน transaction ของ closeBill) */
export async function deductIngredientsForBill(
  client: PoolClient,
  userId: string,
  billId: string,
  lines: SoldLineForStock[],
): Promise<{ ingredientId: string; qtyChange: string }[]> {
  const usage = await resolveIngredientUsage(client, userId, lines);
  const applied: { ingredientId: string; qtyChange: string }[] = [];

  for (const [ingredientId, amount] of usage) {
    if (amount <= 0) continue;
    const qtyChange = -amount;
    await client.query(
      `UPDATE ingredients
       SET stock_qty = stock_qty + $3, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [ingredientId, userId, qtyChange.toFixed(4)],
    );
    await client.query(
      `INSERT INTO ingredient_stock_movements
         (user_id, ingredient_id, bill_id, movement_type, qty_change)
       VALUES ($1, $2, $3, 'sale', $4)`,
      [userId, ingredientId, billId, qtyChange.toFixed(4)],
    );
    applied.push({ ingredientId, qtyChange: qtyChange.toFixed(4) });
  }

  return applied;
}

/** คืนวัตถุดิบตอน void — อ่านจาก movement 'sale' ของบิลนั้น (แม่นกว่าคำนวณใหม่) */
export async function restoreIngredientsForVoidedBill(
  client: PoolClient,
  userId: string,
  billId: string,
): Promise<void> {
  const { rows } = await client.query<{ ingredient_id: string; qty_change: string }>(
    `SELECT ingredient_id, qty_change::text AS qty_change
     FROM ingredient_stock_movements
     WHERE user_id = $1 AND bill_id = $2 AND movement_type = 'sale'`,
    [userId, billId],
  );

  for (const r of rows) {
    const back = -Number(r.qty_change);
    if (!Number.isFinite(back) || back === 0) continue;
    await client.query(
      `UPDATE ingredients
       SET stock_qty = stock_qty + $3, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [r.ingredient_id, userId, back.toFixed(4)],
    );
    await client.query(
      `INSERT INTO ingredient_stock_movements
         (user_id, ingredient_id, bill_id, movement_type, qty_change)
       VALUES ($1, $2, $3, 'void_return', $4)`,
      [userId, r.ingredient_id, billId, back.toFixed(4)],
    );
  }
}

// ---------------------------------------------------------------------------
// รับของเข้า / ปรับสต๊อก
// ---------------------------------------------------------------------------

export type RestockInput = {
  ingredientId: string;
  /** จำนวนที่รับเข้า (หน่วยซื้อ) */
  quantity: number;
  /** ราคารวมที่จ่าย — >0 จะบันทึกเป็นรายจ่ายวัตถุดิบให้อัตโนมัติ */
  totalCost?: number;
  paymentMethod?: "cash" | "transfer";
  /** อัปเดตราคาซื้อของวัตถุดิบตามบิลล่าสุด */
  updatePurchasePrice?: boolean;
  note?: string;
};

export async function restockIngredient(
  userId: string,
  input: RestockInput,
): Promise<{ ingredient: PosIngredient; expenseEntryId: string | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: found } = await client.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients
       WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, input.ingredientId],
    );
    if (!found[0]) throw new PosIngredientNotFoundError();
    assertReceivable(found[0]);

    let expenseEntryId: string | null = null;
    const costCents = input.totalCost ? toCents(input.totalCost) : 0;

    if (costCents > 0) {
      const { rows: exp } = await client.query<{ id: string }>(
        `INSERT INTO expense_entries
           (user_id, amount, category, payment_method, note, entry_date)
         VALUES ($1, $2, 'materials', $3, $4, $5::date)
         RETURNING id`,
        [
          userId,
          centsToDecimalString(costCents),
          input.paymentMethod ?? "cash",
          `รับวัตถุดิบ ${found[0].name} ${input.quantity} ${found[0].purchase_unit}`.slice(0, 255),
          today(),
        ],
      );
      expenseEntryId = exp[0].id;
    }

    // อัปเดตราคาซื้อจากบิลล่าสุด (ต้นทุนสูตรขยับตามราคาจริง)
    if (input.updatePurchasePrice && costCents > 0 && input.quantity > 0) {
      await client.query(
        `UPDATE ingredients
         SET purchase_quantity = $3, purchase_price = $4, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [
          input.ingredientId,
          userId,
          input.quantity,
          centsToDecimalString(costCents),
        ],
      );
    }

    const { rows: updated } = await client.query<IngredientRow>(
      `UPDATE ingredients
       SET stock_qty = stock_qty + $3, track_stock = true, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${INGREDIENT_RETURN}`,
      [input.ingredientId, userId, input.quantity],
    );

    await client.query(
      `INSERT INTO ingredient_stock_movements
         (user_id, ingredient_id, expense_entry_id, movement_type, qty_change, note)
       VALUES ($1, $2, $3, 'restock', $4, $5)`,
      [userId, input.ingredientId, expenseEntryId, input.quantity, input.note ?? null],
    );

    await client.query("COMMIT");
    return { ingredient: mapIngredient(updated[0]), expenseEntryId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// เครื่องยนต์รับของ — ใช้ร่วมกันระหว่างโหมดไปตลาดกับเอกสารการซื้อ (0085)
// ---------------------------------------------------------------------------

/**
 * รับของ 1 บรรทัดเข้าคลัง — จุดเดียวในระบบที่แก้ stock_qty แบบ "เพิ่ม"
 *
 * ═══ ทำอะไรบ้าง ═══════════════════════════════════════════════
 * 1) คำนวณต้นทุนเฉลี่ยถ่วงน้ำหนัก (ของเก่าที่เหลือ + ของใหม่)
 * 2) เพิ่มสต็อก + อัปเดต avg_cost / last_purchase_price
 * 3) ลง movement พร้อมยอดก่อน–หลัง
 *
 * ⚠️ สูตรค่าเฉลี่ยถ่วงน้ำหนักคัดลอกมาจากของเดิมทุกตัวอักษร — ห้ามเปลี่ยน
 *    เพราะต้นทุนเมนูทุกตัวคำนวณต่อจากค่านี้ (trigger 0076)
 *
 * ⚠️ qtyIn และ lineCost ต้องอยู่ใน "หน่วยสต็อก" แล้วเสมอ
 *    การแปลงหน่วยบรรจุ (3 แพ็ค → 252 แผ่น) ทำก่อนเรียกฟังก์ชันนี้
 */
export async function applyReceiveLine(
  client: PoolClient,
  userId: string,
  before: IngredientRow,
  opts: {
    qtyIn: number;
    lineCost: number | null;
    expenseEntryId: string | null;
    purchaseId: string | null;
    note: string | null;
    /**
     * 0089: ของเข้ามาจากไหน
     *   purchase   → movement 'restock' · อัปเดต last_purchase_price + last_purchased_at
     *   production → movement 'production_output' · **ห้ามแตะ last_purchase_price**
     *                เพราะซอสโฮมเมดไม่ได้ถูกซื้อ ถ้าตั้งไว้รายงาน "ซื้อล่าสุด" จะโกหก
     * ไม่ระบุ = purchase (พฤติกรรมเดิมเป๊ะ ทุก caller เดิมไม่ต้องแก้)
     */
    source?: "purchase" | "production";
    productionBatchId?: string | null;
  },
): Promise<{ qtyBefore: number; qtyAfter: number; unitCost: number | null }> {
  const source = opts.source ?? "purchase";
  const isPurchase = source === "purchase";
  const stockBefore = Number(before.stock_qty) || 0;
  const unitCost = opts.lineCost != null ? opts.lineCost / opts.qtyIn : null;

  // ค่าเฉลี่ยถ่วงน้ำหนัก — ของเก่าที่เหลือ + ของใหม่ที่เพิ่งซื้อ
  // สต็อกติดลบนับเป็น 0 ในการถ่วงน้ำหนัก (ไม่งั้นค่าเฉลี่ยเพี้ยน)
  let avgCost = before.avg_cost == null ? null : Number(before.avg_cost);
  if (unitCost != null) {
    const base = avgCost ?? unitCost;
    const totalQty = Math.max(stockBefore, 0) + opts.qtyIn;
    avgCost =
      totalQty > 0
        ? (Math.max(stockBefore, 0) * base + opts.qtyIn * unitCost) / totalQty
        : unitCost;
  }

  // ราคาซื้อล่าสุด: อัปเดตเฉพาะตอน "ซื้อ" จริง — การผลิตไม่ใช่การซื้อ
  const lastPrice = isPurchase && unitCost != null ? unitCost.toFixed(2) : null;

  await client.query(
    `UPDATE ingredients
     SET stock_qty = stock_qty + $3,
         track_stock = true,
         avg_cost = COALESCE($4, avg_cost),
         last_purchase_price = COALESCE($5, last_purchase_price),
         last_purchased_at = CASE WHEN $5 IS NULL THEN last_purchased_at ELSE now() END,
         updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [
      before.id,
      userId,
      opts.qtyIn,
      avgCost == null ? null : avgCost.toFixed(4),
      lastPrice,
    ],
  );

  const qtyAfter = stockBefore + opts.qtyIn;
  await client.query(
    `INSERT INTO ingredient_stock_movements
       (user_id, ingredient_id, expense_entry_id, purchase_id, production_batch_id,
        movement_type, qty_change, qty_before, qty_after, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId,
      before.id,
      opts.expenseEntryId,
      opts.purchaseId,
      opts.productionBatchId ?? null,
      isPurchase ? "restock" : "production_output",
      opts.qtyIn,
      stockBefore.toFixed(4),
      qtyAfter.toFixed(4),
      opts.note,
    ],
  );

  return { qtyBefore: stockBefore, qtyAfter, unitCost };
}

// ---------------------------------------------------------------------------
// โหมดไปตลาด — รับของทั้งตะกร้าใน transaction เดียว
// ---------------------------------------------------------------------------

export type MarketTripLine = {
  ingredientId: string;
  /** จำนวนที่ซื้อ (หน่วยซื้อ) */
  quantity: number;
  /** ราคารวมของบรรทัดนี้ (ไม่ใส่ = ไม่รู้ราคา ใช้ราคาล่าสุดมาประมาณ) */
  lineCost?: number;
};

export type MarketTripInput = {
  lines: MarketTripLine[];
  /** ของนอกลิสต์ที่ไม่ได้ track เช่น ถุงกระดาษ ทิชชู่ — ลงเป็นรายจ่ายอย่างเดียว */
  extraItems?: { label: string; amount: number }[];
  paymentMethod?: "cash" | "transfer";
  note?: string;
};

export type MarketTripResult = {
  received: number;
  totalCost: string;
  expenseEntryId: string | null;
};

/**
 * รับของจากการไปตลาด 1 รอบ = 1 รายการรายจ่าย (ไม่ใช่รายการละบรรทัด)
 * ทำครบใน transaction เดียว: เพิ่มสต๊อก · ลง movement · อัปเดตราคาล่าสุด+เฉลี่ย · ลงรายจ่าย
 */
export async function restockIngredientsBatch(
  userId: string,
  input: MarketTripInput,
): Promise<MarketTripResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ล็อกทุกแถวที่จะแตะ (เรียง id กัน deadlock)
    const ids = [...new Set(input.lines.map((l) => l.ingredientId))].sort();
    const { rows: locked } = await client.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients
       WHERE user_id = $1 AND id = ANY($2::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [userId, ids],
    );
    if (locked.length !== ids.length) throw new PosIngredientNotFoundError();
    locked.forEach(assertReceivable);
    const byId = new Map(locked.map((r) => [r.id, r]));

    // ยอดรวมทั้งทริป (สตางค์-safe)
    let totalCents = 0;
    for (const l of input.lines) totalCents += l.lineCost ? toCents(l.lineCost) : 0;
    for (const e of input.extraItems ?? []) totalCents += toCents(e.amount);

    // 1) รายจ่าย 1 รายการต่อ 1 ทริป
    let expenseEntryId: string | null = null;
    if (totalCents > 0) {
      const itemCount = input.lines.length + (input.extraItems?.length ?? 0);
      const label =
        input.note?.trim() ||
        `ซื้อวัตถุดิบ ${itemCount} รายการ` +
          ((input.extraItems?.length ?? 0) > 0
            ? ` (รวม ${input.extraItems!.map((e) => e.label).join(", ")})`
            : "");
      const { rows: exp } = await client.query<{ id: string }>(
        `INSERT INTO expense_entries
           (user_id, amount, category, payment_method, note, entry_date)
         VALUES ($1, $2, 'materials', $3, $4, $5::date)
         RETURNING id`,
        [
          userId,
          centsToDecimalString(totalCents),
          input.paymentMethod ?? "cash",
          label.slice(0, 255),
          today(),
        ],
      );
      expenseEntryId = exp[0].id;
    }

    // 2) รับเข้าทีละบรรทัด — ใช้เครื่องยนต์เดียวกับ receivePurchase()
    for (const line of input.lines) {
      if (line.quantity <= 0) continue;
      await applyReceiveLine(client, userId, byId.get(line.ingredientId)!, {
        qtyIn: line.quantity,
        lineCost: line.lineCost ?? null,
        expenseEntryId,
        purchaseId: null,
        note: line.lineCost ? `฿${line.lineCost.toFixed(2)}` : "ไม่ระบุราคา",
      });
    }

    await client.query("COMMIT");
    return {
      received: input.lines.filter((l) => l.quantity > 0).length,
      totalCost: centsToDecimalString(totalCents),
      expenseEntryId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** ตรวจนับ/ปรับสต๊อก: ตั้งเป็นจำนวนจริงที่นับได้ → ลง movement ส่วนต่าง */
export async function adjustIngredientStock(
  userId: string,
  ingredientId: string,
  actualQty: number,
  note?: string,
): Promise<PosIngredient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: found } = await client.query<IngredientRow>(
      `SELECT ${INGREDIENT_RETURN} FROM ingredients
       WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, ingredientId],
    );
    if (!found[0]) throw new PosIngredientNotFoundError();

    const diff = actualQty - Number(found[0].stock_qty);

    const { rows: updated } = await client.query<IngredientRow>(
      `UPDATE ingredients SET stock_qty = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${INGREDIENT_RETURN}`,
      [ingredientId, userId, actualQty],
    );

    if (Math.abs(diff) > 0.00005) {
      await client.query(
        `INSERT INTO ingredient_stock_movements
           (user_id, ingredient_id, movement_type, qty_change, note)
         VALUES ($1, $2, 'adjustment', $3, $4)`,
        [userId, ingredientId, diff.toFixed(4), note ?? "ตรวจนับสต๊อก"],
      );
    }

    await client.query("COMMIT");
    return mapIngredient(updated[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// ลิสต์ต้องซื้อ — ใช้ไปเท่าไหร่ / เหลือพอกี่วัน
// ---------------------------------------------------------------------------

export type ShoppingListItem = {
  ingredientId: string;
  name: string;
  purchaseUnit: PurchaseUnit;
  stockQty: string;
  lowStockThreshold: string | null;
  /** ใช้ไปในช่วงที่ดู (หน่วยซื้อ) */
  usedInPeriod: string;
  /** อัตราใช้เฉลี่ยต่อวัน */
  dailyUsage: string;
  /** พอขายอีกกี่วัน (null = ยังไม่มีข้อมูลการใช้) */
  daysLeft: number | null;
  /** ปริมาณแนะนำให้ซื้อ (ให้พอ ~7 วัน) — หน่วยสต็อก */
  suggestedPurchase: string;
  urgency: "critical" | "low" | "ok";
  /** 0085: เป้าหมายสต็อก (null = ใช้การพยากรณ์ล้วน ๆ) */
  targetStock: string | null;
  /** 0085: คำแนะนำแปลงเป็นหีบห่อ เช่น "≈ 2 แพ็ค" (null = ซื้อเป็นหน่วยสต็อก) */
  suggestedPack: { unitName: string; quantity: string } | null;
};

export async function getShoppingList(
  userId: string,
  days = 14,
): Promise<{ days: number; items: ShoppingListItem[] }> {
  const lookback = Math.min(Math.max(days, 1), 90);
  const { rows } = await pool.query<{
    id: string;
    name: string;
    purchase_unit: string;
    stock_qty: string;
    low_stock_threshold: string | null;
    target_stock: string | null;
    pack_unit: string | null;
    pack_factor: string | null;
    used: string;
  }>(
    `SELECT i.id, i.name, i.purchase_unit,
            i.stock_qty::text AS stock_qty,
            i.low_stock_threshold::text AS low_stock_threshold,
            i.target_stock::text AS target_stock,
            u.unit_name AS pack_unit,
            u.conversion_factor::text AS pack_factor,
            COALESCE((
              SELECT SUM(-m.qty_change)
              FROM ingredient_stock_movements m
              WHERE m.ingredient_id = i.id
                -- 0089: วัตถุดิบถูกใช้ไป 2 ทาง ต้องนับทั้งคู่
                --   sale             = ขายอาหารตรง ๆ
                --   production_input = ถูกใช้ผลิตซอส
                -- ถ้านับแค่ sale: Mayo ที่ถูกใช้ผลิต 2,000g จะรายงานว่าใช้ 0g
                -- → daysLeft ผิด → ไม่เตือนให้ซื้อ → Mayo หมดกลางร้าน
                --
                -- ⚠️ production_output ห้ามนับ — มันคือของ "เข้า" ไม่ใช่ของใช้ไป
                --    (ตัวเลข qty_change เป็นบวก ถ้าเผลอนับจะหักกลบกันจนเพี้ยน)
                AND m.movement_type IN ('sale', 'production_input')
                AND m.created_at >= now() - ($2 || ' days')::interval
            ), 0)::text AS used
     FROM ingredients i
     LEFT JOIN ingredient_purchase_units u
            ON u.ingredient_id = i.id AND u.is_active AND u.is_default
     WHERE i.user_id = $1 AND i.track_stock = true
     ORDER BY i.name ASC`,
    [userId, String(lookback)],
  );

  const items = rows.map((r) => {
    const stock = Number(r.stock_qty);
    const used = Math.max(Number(r.used), 0);
    const daily = used / lookback;
    const daysLeft = daily > 0 ? Math.floor(stock / daily) : null;
    const threshold = r.low_stock_threshold == null ? null : Number(r.low_stock_threshold);

    // ควรซื้อให้พอ ~7 วัน (เผื่อ buffer) หรือเติมถึง threshold ถ้าตั้งไว้
    const targetFor7Days = daily * 7;
    const target = Math.max(targetFor7Days, threshold ?? 0);
    const forecastSuggested = Math.max(target - stock, 0);

    // 0085: target_stock เป็นตัวเสริม ไม่ทับการพยากรณ์
    // NULL → พฤติกรรมเดิม 100% · มีค่า → ใช้ค่าที่มากกว่า และไม่ติดลบ
    const targetStock = r.target_stock == null ? null : Number(r.target_stock);
    const suggested =
      targetStock == null
        ? forecastSuggested
        : Math.max(forecastSuggested, Math.max(targetStock - stock, 0));

    // แปลงคำแนะนำเป็นหีบห่อ — ปัดขึ้นเพราะซื้อครึ่งแพ็คไม่ได้
    const packFactor = r.pack_factor == null ? null : Number(r.pack_factor);
    const suggestedPack =
      r.pack_unit && packFactor && packFactor > 0 && suggested > 0
        ? { unitName: r.pack_unit, quantity: String(Math.ceil(suggested / packFactor)) }
        : null;

    const urgency: ShoppingListItem["urgency"] =
      (daysLeft !== null && daysLeft <= 1) || (threshold !== null && stock <= threshold * 0.5)
        ? "critical"
        : (daysLeft !== null && daysLeft <= 3) || (threshold !== null && stock <= threshold)
          ? "low"
          : "ok";

    return {
      ingredientId: r.id,
      name: r.name,
      purchaseUnit: r.purchase_unit as PurchaseUnit,
      stockQty: stock.toFixed(3),
      lowStockThreshold: r.low_stock_threshold,
      usedInPeriod: used.toFixed(3),
      dailyUsage: daily.toFixed(3),
      daysLeft,
      suggestedPurchase: suggested.toFixed(3),
      urgency,
      targetStock: r.target_stock,
      suggestedPack,
    };
  });

  const order = { critical: 0, low: 1, ok: 2 } as const;
  items.sort((a, b) => order[a.urgency] - order[b.urgency] || a.name.localeCompare(b.name, "th"));

  return { days: lookback, items };
}
