import { pool } from "@/lib/db";
import {
  listPosModifierGroups,
  listProductModifierGroupLinks,
} from "@/lib/pos-modifier-queries";
import type {
  CreatePosCategoryInput,
  CreatePosProductInput,
  UpdatePosCategoryInput,
  UpdatePosProductInput,
} from "@/lib/pos-validation";
import type { PosCatalog, PosCategory, PosProduct, PosProductPublic } from "@/types/pos";

type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
};

type ProductRow = {
  id: string;
  name: string;
  sell_price: string;
  cost_price: string;
  stock_qty: string;
  track_stock: boolean;
  category_id: string | null;
  unit: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

const CATEGORY_RETURN = `id, name, color, sort_order`;
const PRODUCT_RETURN = `id, name, sell_price::text AS sell_price, cost_price::text AS cost_price,
  stock_qty::text AS stock_qty, track_stock, category_id, unit, image_url, sort_order, is_active`;

function mapCategory(r: CategoryRow): PosCategory {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    sortOrder: r.sort_order,
  };
}

function mapProductPublic(r: ProductRow): PosProductPublic {
  return {
    id: r.id,
    name: r.name,
    sellPrice: r.sell_price,
    trackStock: r.track_stock,
    stockQty: r.stock_qty,
    categoryId: r.category_id,
    unit: r.unit,
    imageUrl: r.image_url,
    isActive: r.is_active,
  };
}

function mapProduct(r: ProductRow): PosProduct {
  return {
    ...mapProductPublic(r),
    costPrice: r.cost_price,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
}

export class PosInvalidCategoryError extends Error {
  constructor() {
    super("pos invalid category");
    this.name = "PosInvalidCategoryError";
  }
}

export class PosCategoryNameExistsError extends Error {
  constructor() {
    super("pos category name exists");
    this.name = "PosCategoryNameExistsError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

export async function listPosCatalog(
  userId: string,
  opts?: { includeInactive?: boolean; includeCost?: boolean },
): Promise<PosCatalog> {
  const productFilter = opts?.includeInactive ? "" : " AND is_active = true";
  const [categoriesResult, productsResult, modifierGroups, groupLinks] = await Promise.all([
    pool.query<CategoryRow>(
      `SELECT ${CATEGORY_RETURN}
       FROM pos_categories
       WHERE user_id = $1 AND is_active = true
       ORDER BY sort_order ASC, name ASC`,
      [userId],
    ),
    pool.query<ProductRow>(
      `SELECT ${PRODUCT_RETURN}
       FROM pos_products
       WHERE user_id = $1${productFilter}
       ORDER BY sort_order ASC, name ASC`,
      [userId],
    ),
    listPosModifierGroups(userId, { includeInactive: opts?.includeInactive }),
    listProductModifierGroupLinks(userId),
  ]);

  return {
    categories: categoriesResult.rows.map(mapCategory),
    products: productsResult.rows.map((r) => {
      const base = mapProductPublic(r);
      const modifierGroupIds = groupLinks.get(r.id);
      const withGroups = modifierGroupIds?.length ? { ...base, modifierGroupIds } : base;
      if (!opts?.includeCost) return withGroups;
      return { ...withGroups, costPrice: r.cost_price };
    }),
    modifierGroups,
  };
}

export async function isPosCategoryOwned(
  userId: string,
  categoryId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pos_categories
       WHERE id = $1 AND user_id = $2
     ) AS ok`,
    [categoryId, userId],
  );
  return rows[0]?.ok === true;
}

export async function createPosProduct(
  userId: string,
  input: CreatePosProductInput,
): Promise<PosProduct> {
  if (input.categoryId) {
    const owned = await isPosCategoryOwned(userId, input.categoryId);
    if (!owned) throw new PosInvalidCategoryError();
  }

  const { rows } = await pool.query<ProductRow>(
    `INSERT INTO pos_products
       (user_id, name, sell_price, cost_price, stock_qty, track_stock, category_id, unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${PRODUCT_RETURN}`,
    [
      userId,
      input.name,
      input.sellPrice.toFixed(2),
      input.costPrice.toFixed(2),
      input.stockQty.toFixed(3),
      input.trackStock,
      input.categoryId ?? null,
      input.unit ?? null,
    ],
  );

  if (!rows[0]) throw new Error("Could not create POS product");
  return mapProduct(rows[0]);
}

export async function updatePosProduct(
  userId: string,
  productId: string,
  input: UpdatePosProductInput,
): Promise<PosProduct | null> {
  if (input.categoryId) {
    const owned = await isPosCategoryOwned(userId, input.categoryId);
    if (!owned) throw new PosInvalidCategoryError();
  }

  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [userId, productId];
  let idx = 3;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx += 1;
  }
  if (input.sellPrice !== undefined) {
    sets.push(`sell_price = $${idx}`);
    params.push(input.sellPrice.toFixed(2));
    idx += 1;
  }
  if (input.costPrice !== undefined) {
    sets.push(`cost_price = $${idx}`);
    params.push(input.costPrice.toFixed(2));
    idx += 1;
  }
  if (input.trackStock !== undefined) {
    sets.push(`track_stock = $${idx}`);
    params.push(input.trackStock);
    idx += 1;
  }
  if (input.categoryId !== undefined) {
    sets.push(`category_id = $${idx}`);
    params.push(input.categoryId);
    idx += 1;
  }
  if (input.unit !== undefined) {
    sets.push(`unit = $${idx}`);
    params.push(input.unit);
    idx += 1;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx += 1;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx += 1;
  }

  if (sets.length === 0) {
    const { rows } = await pool.query<ProductRow>(
      `SELECT ${PRODUCT_RETURN}
       FROM pos_products
       WHERE id = $2 AND user_id = $1`,
      [userId, productId],
    );
    return rows[0] ? mapProduct(rows[0]) : null;
  }

  sets.push("updated_at = now()");

  const { rows } = await pool.query<ProductRow>(
    `UPDATE pos_products SET ${sets.join(", ")}
     WHERE id = $2 AND user_id = $1
     RETURNING ${PRODUCT_RETURN}`,
    params,
  );

  return rows[0] ? mapProduct(rows[0]) : null;
}

/**
 * Current image_url of an owned product.
 * Returns `undefined` when the product does not exist / is not owned,
 * `null` when it exists but has no image.
 */
export async function getPosProductImageUrl(
  userId: string,
  productId: string,
): Promise<string | null | undefined> {
  const { rows } = await pool.query<{ image_url: string | null }>(
    `SELECT image_url FROM pos_products WHERE id = $2 AND user_id = $1`,
    [userId, productId],
  );
  if (!rows[0]) return undefined;
  return rows[0].image_url;
}

export async function setPosProductImageUrl(
  userId: string,
  productId: string,
  imageUrl: string | null,
): Promise<PosProduct | null> {
  const { rows } = await pool.query<ProductRow>(
    `UPDATE pos_products SET image_url = $3, updated_at = now()
     WHERE id = $2 AND user_id = $1
     RETURNING ${PRODUCT_RETURN}`,
    [userId, productId, imageUrl],
  );
  return rows[0] ? mapProduct(rows[0]) : null;
}

/**
 * Hard-delete a product. Safe for history: pos_bill_items keeps
 * product_name/prices as snapshot (product_id → NULL via FK), stock movements
 * cascade away, modifier-group links cascade.
 * Returns the old image_url for storage cleanup, undefined if not found/owned.
 */
export async function deletePosProduct(
  userId: string,
  productId: string,
): Promise<{ imageUrl: string | null } | undefined> {
  const { rows } = await pool.query<{ image_url: string | null }>(
    `DELETE FROM pos_products
     WHERE id = $2 AND user_id = $1
     RETURNING image_url`,
    [userId, productId],
  );
  if (!rows[0]) return undefined;
  return { imageUrl: rows[0].image_url };
}

export async function createPosCategory(
  userId: string,
  input: CreatePosCategoryInput,
): Promise<PosCategory> {
  try {
    const { rows } = await pool.query<CategoryRow>(
      `INSERT INTO pos_categories (user_id, name, color, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING ${CATEGORY_RETURN}`,
      [userId, input.name, input.color ?? null, input.sortOrder],
    );
    if (!rows[0]) throw new Error("Could not create POS category");
    return mapCategory(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosCategoryNameExistsError();
    throw err;
  }
}

/**
 * ลบหมวดหมู่ — ทำได้เมื่อไม่มีสินค้าผูกอยู่
 *
 * นโยบาย: ไม่ยอมให้ลบทั้งที่มีสินค้าผูก เพราะสินค้าจะหลุดไปกองรวมโดยที่ร้านไม่รู้ตัว
 * → คืนจำนวนสินค้าไปให้ UI บอกว่า "ย้ายออกก่อน" (หรือกด OFF หมวดไว้เฉยๆ ก็ได้)
 */
export class PosCategoryInUseError extends Error {
  constructor(public productCount: number) {
    super("category still has products");
    this.name = "PosCategoryInUseError";
  }
}

export async function deletePosCategory(userId: string, categoryId: string): Promise<boolean> {
  const { rows: used } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM pos_products
     WHERE user_id = $1 AND category_id = $2`,
    [userId, categoryId],
  );
  const count = Number(used[0]?.n ?? 0);
  if (count > 0) throw new PosCategoryInUseError(count);

  const { rowCount } = await pool.query(
    `DELETE FROM pos_categories WHERE id = $2 AND user_id = $1`,
    [userId, categoryId],
  );
  return Boolean(rowCount);
}

export async function updatePosCategory(
  userId: string,
  categoryId: string,
  input: UpdatePosCategoryInput,
): Promise<PosCategory | null> {
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [userId, categoryId];
  let idx = 3;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx += 1;
  }
  if (input.color !== undefined) {
    sets.push(`color = $${idx}`);
    params.push(input.color);
    idx += 1;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx += 1;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx += 1;
  }

  if (sets.length === 0) {
    const { rows } = await pool.query<CategoryRow>(
      `SELECT ${CATEGORY_RETURN}
       FROM pos_categories
       WHERE id = $2 AND user_id = $1`,
      [userId, categoryId],
    );
    return rows[0] ? mapCategory(rows[0]) : null;
  }

  sets.push("updated_at = now()");

  try {
    const { rows } = await pool.query<CategoryRow>(
      `UPDATE pos_categories SET ${sets.join(", ")}
       WHERE id = $2 AND user_id = $1
       RETURNING ${CATEGORY_RETURN}`,
      params,
    );
    return rows[0] ? mapCategory(rows[0]) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PosCategoryNameExistsError();
    throw err;
  }
}
