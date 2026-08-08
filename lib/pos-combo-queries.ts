import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { sumDecimals } from "@/lib/money";
import {
  allocateComboPrice,
  type AllocatedComponent,
  type ComboComponent,
} from "@/lib/pos-combo-pricing";

/**
 * คอมโบ (0071)
 *
 * ⚠️ ราคาป้ายรวมของคอมโบ "ไม่เก็บใน DB" — คำนวณสดจากราคาสินค้าปัจจุบันเสมอ
 *    เพราะถ้าเก็บไว้ พอร้านขึ้นราคาเบอร์เกอร์ ป้าย "ประหยัด ฿30" จะกลายเป็นคำโกหก
 *    ที่เก็บใน DB มีแค่ combo_price (ราคาที่ลูกค้าจ่าย) ซึ่งร้านตั้งเอง
 */

export type PosComboItem = {
  productId: string;
  productName: string;
  quantity: number;
  /** ราคาป้ายต่อหน่วย ณ ตอนนี้ */
  listUnitPrice: string;
  imageUrl: string | null;
  isActive: boolean;
  trackStock: boolean;
  stockQty: string;
};

export type PosCombo = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  comboPrice: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  items: PosComboItem[];
  /** Σ ราคาป้าย × จำนวน (คำนวณสด) */
  listTotal: string;
  /** listTotal − comboPrice */
  savings: string;
  /**
   * ขายได้จริงไหม ณ ตอนนี้ — false เมื่อ:
   * สินค้าในคอมโบถูกปิดขาย / คอมโบยังไม่ถึงเวลา / หมดเวลาแล้ว / ไม่มีรายการสินค้า
   */
  sellable: boolean;
  unavailableReason: string | null;
};

export class PosComboNotFoundError extends Error {
  constructor() {
    super("combo_not_found");
  }
}
export class PosComboInvalidProductError extends Error {
  constructor() {
    super("invalid_product");
  }
}

type ComboRow = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  combo_price: string;
  sort_order: number;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
};

type ComboItemRow = {
  combo_id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  sell_price: string;
  image_url: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_qty: string;
};

function buildCombo(row: ComboRow, itemRows: ComboItemRow[], now: Date): PosCombo {
  const items: PosComboItem[] = itemRows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    quantity: parseFloat(r.quantity),
    listUnitPrice: r.sell_price,
    imageUrl: r.image_url,
    isActive: r.is_active,
    trackStock: r.track_stock,
    stockQty: r.stock_qty,
  }));

  const listTotal = items.length
    ? sumDecimals(...items.map((i) => (parseFloat(i.listUnitPrice) * i.quantity).toFixed(2)))
    : "0.00";
  const savings = (parseFloat(listTotal) - parseFloat(row.combo_price)).toFixed(2);

  let unavailableReason: string | null = null;
  if (items.length === 0) unavailableReason = "no_items";
  else if (items.some((i) => !i.isActive)) unavailableReason = "product_inactive";
  else if (row.starts_at && row.starts_at > now) unavailableReason = "not_started";
  else if (row.ends_at && row.ends_at <= now) unavailableReason = "ended";

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    comboPrice: row.combo_price,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    startsAt: row.starts_at ? row.starts_at.toISOString() : null,
    endsAt: row.ends_at ? row.ends_at.toISOString() : null,
    items,
    listTotal,
    savings,
    sellable: row.is_active && unavailableReason === null,
    unavailableReason,
  };
}

export async function listPosCombos(
  userId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<PosCombo[]> {
  const { rows } = await pool.query<ComboRow>(
    `SELECT id, name, description, image_url, combo_price::text AS combo_price,
            sort_order, is_active, starts_at, ends_at
     FROM pos_combos
     WHERE user_id = $1 ${opts.includeInactive ? "" : "AND is_active = true"}
     ORDER BY sort_order ASC, created_at ASC`,
    [userId],
  );
  if (rows.length === 0) return [];

  const { rows: itemRows } = await pool.query<ComboItemRow>(
    `SELECT ci.combo_id, ci.product_id, p.name AS product_name,
            ci.quantity::text AS quantity, p.sell_price::text AS sell_price,
            p.image_url, p.is_active, p.track_stock, p.stock_qty::text AS stock_qty
     FROM pos_combo_items ci
     JOIN pos_products p ON p.id = ci.product_id
     WHERE ci.combo_id = ANY($1::uuid[])
     ORDER BY ci.sort_order ASC, p.name ASC`,
    [rows.map((r) => r.id)],
  );

  const now = new Date();
  const byCombo = new Map<string, ComboItemRow[]>();
  for (const r of itemRows) {
    const list = byCombo.get(r.combo_id) ?? [];
    list.push(r);
    byCombo.set(r.combo_id, list);
  }
  return rows.map((r) => buildCombo(r, byCombo.get(r.id) ?? [], now));
}

export async function getPosCombo(userId: string, comboId: string): Promise<PosCombo | null> {
  const { rows } = await pool.query<ComboRow>(
    `SELECT id, name, description, image_url, combo_price::text AS combo_price,
            sort_order, is_active, starts_at, ends_at
     FROM pos_combos WHERE id = $2 AND user_id = $1`,
    [userId, comboId],
  );
  if (!rows[0]) return null;
  const { rows: itemRows } = await pool.query<ComboItemRow>(
    `SELECT ci.combo_id, ci.product_id, p.name AS product_name,
            ci.quantity::text AS quantity, p.sell_price::text AS sell_price,
            p.image_url, p.is_active, p.track_stock, p.stock_qty::text AS stock_qty
     FROM pos_combo_items ci
     JOIN pos_products p ON p.id = ci.product_id
     WHERE ci.combo_id = $1
     ORDER BY ci.sort_order ASC, p.name ASC`,
    [comboId],
  );
  return buildCombo(rows[0], itemRows, new Date());
}

export type UpsertComboInput = {
  name: string;
  description?: string | null;
  comboPrice: number;
  sortOrder?: number;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  items: { productId: string; quantity: number }[];
};

/**
 * สร้าง/แก้คอมโบ + รายการสินค้าใน transaction เดียว
 * ตรวจว่าสินค้าทุกตัวเป็นของร้านนี้จริง — กันส่ง product_id ของร้านอื่นเข้ามา (IDOR)
 */
export async function upsertPosCombo(
  userId: string,
  input: UpsertComboInput,
  comboId?: string,
): Promise<PosCombo> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productIds = input.items.map((i) => i.productId);
    if (productIds.length > 0) {
      const { rows: owned } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM pos_products
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, productIds],
      );
      if (Number(owned[0].n) !== new Set(productIds).size) {
        throw new PosComboInvalidProductError();
      }
    }

    let id = comboId;
    if (id) {
      const { rowCount } = await client.query(
        `UPDATE pos_combos
         SET name = $3, description = $4, combo_price = $5,
             sort_order = COALESCE($6, sort_order), is_active = COALESCE($7, is_active),
             starts_at = $8, ends_at = $9, updated_at = now()
         WHERE id = $2 AND user_id = $1`,
        [
          userId, id, input.name, input.description ?? null,
          input.comboPrice.toFixed(2), input.sortOrder ?? null,
          input.isActive ?? null, input.startsAt ?? null, input.endsAt ?? null,
        ],
      );
      if (!rowCount) throw new PosComboNotFoundError();
      await client.query(`DELETE FROM pos_combo_items WHERE combo_id = $1`, [id]);
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO pos_combos
           (user_id, name, description, combo_price, sort_order, is_active, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, true), $7, $8)
         RETURNING id`,
        [
          userId, input.name, input.description ?? null, input.comboPrice.toFixed(2),
          input.sortOrder ?? null, input.isActive ?? null,
          input.startsAt ?? null, input.endsAt ?? null,
        ],
      );
      id = rows[0].id;
    }

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      await client.query(
        `INSERT INTO pos_combo_items (combo_id, product_id, quantity, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [id, it.productId, it.quantity, i],
      );
    }

    await client.query("COMMIT");
    const saved = await getPosCombo(userId, id);
    if (!saved) throw new PosComboNotFoundError();
    return saved;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePosCombo(userId: string, comboId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM pos_combos WHERE id = $2 AND user_id = $1`,
    [userId, comboId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * แปลง "คอมโบ 1 ชุด" เป็นบรรทัดสินค้าจริงพร้อมราคาที่กระจายแล้ว
 * ใช้ตอนปิดบิล/สร้างออเดอร์ — อ่านราคาป้ายจาก DB สด ๆ ใน transaction เดียวกัน
 *
 * ⚠️ ราคาที่ใช้คือราคาใน DB ณ วินาทีที่ปิดบิล ไม่ใช่ราคาที่ client ส่งมา
 */
export async function expandComboToLines(
  client: PoolClient,
  userId: string,
  comboId: string,
  comboQty: number,
): Promise<{
  comboName: string;
  lines: AllocatedComponent[];
  listTotal: string;
  netTotal: string;
  discount: string;
}> {
  const { rows: comboRows } = await client.query<{
    name: string;
    combo_price: string;
    is_active: boolean;
    starts_at: Date | null;
    ends_at: Date | null;
  }>(
    `SELECT name, combo_price::text AS combo_price, is_active, starts_at, ends_at
     FROM pos_combos WHERE id = $2 AND user_id = $1
     FOR UPDATE`,
    [userId, comboId],
  );
  const combo = comboRows[0];
  if (!combo) throw new PosComboNotFoundError();

  const now = new Date();
  if (!combo.is_active) throw new PosComboNotFoundError();
  if (combo.starts_at && combo.starts_at > now) throw new PosComboNotFoundError();
  if (combo.ends_at && combo.ends_at <= now) throw new PosComboNotFoundError();

  const { rows: itemRows } = await client.query<{
    product_id: string;
    quantity: string;
    sell_price: string;
    is_active: boolean;
  }>(
    `SELECT ci.product_id, ci.quantity::text AS quantity,
            p.sell_price::text AS sell_price, p.is_active
     FROM pos_combo_items ci
     JOIN pos_products p ON p.id = ci.product_id AND p.user_id = $1
     WHERE ci.combo_id = $2
     ORDER BY ci.sort_order ASC`,
    [userId, comboId],
  );
  if (itemRows.length === 0) throw new PosComboNotFoundError();
  if (itemRows.some((r) => !r.is_active)) throw new PosComboInvalidProductError();

  const components: ComboComponent[] = itemRows.map((r) => ({
    productId: r.product_id,
    listUnitPrice: r.sell_price,
    quantity: parseFloat(r.quantity),
  }));

  const allocated = allocateComboPrice(components, combo.combo_price, comboQty);
  return { comboName: combo.name, ...allocated };
}
