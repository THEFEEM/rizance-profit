import { pool } from "@/lib/db";

/**
 * Menu Cost Dashboard (0076) — ต้นทุนเมนูจากสูตร คำนวณสด ไม่มีค่ากรอกมือ
 *
 * cost_price ของเมนูที่ผูกสูตร DB sync ให้เองผ่าน trigger แล้ว —
 * แต่ dashboard คำนวณจากสูตรตรง ๆ อีกรอบ (แหล่งเดียวกับ trigger)
 * เพื่อโชว์ breakdown รายวัตถุดิบได้ และไม่มีทางโชว์ค่าค้าง
 *
 * ราคาแนะนำ: ปัดขึ้นเป็นบาทเต็ม — ต้นทุน ÷ (target/100) แล้ว ceil
 * (ปัดขึ้นเสมอ: ปัดลงแปลว่าขายต่ำกว่าเป้า)
 */

export type MenuCostLine = {
  ingredientName: string;
  quantity: string;
  unit: string;
  unitCost: string | null; // avg_cost — null = วัตถุดิบยังไม่มีราคา
  lineCost: string;        // quantity × unitCost (0 ถ้ายังไม่มีราคา)
};

export type MenuCost = {
  productId: string;
  productName: string;
  sellPrice: string;
  ingredientCost: string;
  foodCostPct: string | null; // null เมื่อราคาขาย 0
  grossProfit: string;
  /** ok = FC ≤ เป้า · over = เกินเป้า */
  status: "ok" | "over";
  /** ราคาขายต่ำสุด (บาทเต็ม) ที่ทำให้ FC ≤ เป้า — ส่งเฉพาะตอน over */
  recommendedPrice: string | null;
  /** จำนวนวัตถุดิบในสูตรที่ยังไม่มีราคา (ต้นทุนจริงสูงกว่าที่เห็น) */
  unpricedCount: number;
  lines: MenuCostLine[];
};

export type ModifierCost = {
  modifierName: string;
  groupName: string;
  priceDelta: string;
  cost: string;
};

export type MenuCostDashboard = {
  targetPct: string;
  products: MenuCost[];
  /** เมนูที่ยังไม่ผูกสูตร — ต้นทุนยังเป็นค่ากรอกมือ/0 */
  noRecipe: { productId: string; productName: string; sellPrice: string }[];
  modifiers: ModifierCost[];
};

type LineRow = {
  product_id: string;
  product_name: string;
  sell_price: string;
  ingredient_name: string;
  quantity: string;
  unit: string;
  avg_cost: string | null;
};

const r2 = (n: number) => n.toFixed(2);

export async function getMenuCostDashboard(
  userId: string,
): Promise<MenuCostDashboard> {
  const [{ rows: settingRows }, { rows: lineRows }, { rows: bare }, { rows: modRows }] =
    await Promise.all([
      pool.query<{ target_food_cost_pct: string }>(
        `SELECT target_food_cost_pct::text FROM pos_shop_settings WHERE user_id = $1`,
        [userId],
      ),
      pool.query<LineRow>(
        `SELECT p.id AS product_id, p.name AS product_name,
                p.sell_price::text AS sell_price,
                i.name AS ingredient_name, pi.quantity::text AS quantity,
                i.purchase_unit AS unit, i.avg_cost::text AS avg_cost
         FROM pos_products p
         JOIN pos_product_ingredients pi ON pi.product_id = p.id
         JOIN ingredients i ON i.id = pi.ingredient_id
         WHERE p.user_id = $1
         ORDER BY p.name ASC, (pi.quantity * COALESCE(i.avg_cost, 0)) DESC`,
        [userId],
      ),
      pool.query<{ id: string; name: string; sell_price: string }>(
        `SELECT id, name, sell_price::text FROM pos_products p
         WHERE p.user_id = $1 AND p.is_active
           AND NOT EXISTS (
             SELECT 1 FROM pos_product_ingredients pi WHERE pi.product_id = p.id)
         ORDER BY name ASC`,
        [userId],
      ),
      pool.query<{
        modifier_name: string;
        group_name: string;
        price_delta: string;
        cost: string;
      }>(
        `SELECT m.name AS modifier_name, g.name AS group_name,
                m.price_delta::text AS price_delta,
                ROUND(SUM(mi.quantity * COALESCE(i.avg_cost, 0)), 2)::text AS cost
         FROM pos_modifier_ingredients mi
         JOIN pos_modifiers m ON m.id = mi.modifier_id
         JOIN pos_modifier_groups g ON g.id = m.group_id
         JOIN ingredients i ON i.id = mi.ingredient_id
         WHERE g.user_id = $1
         GROUP BY m.id, m.name, g.name, m.price_delta
         ORDER BY g.name, m.name`,
        [userId],
      ),
    ]);

  const targetPct = settingRows[0]?.target_food_cost_pct ?? "37";
  const target = Number(targetPct);

  const byProduct = new Map<
    string,
    { name: string; sellPrice: string; lines: MenuCostLine[]; unpriced: number; cost: number }
  >();
  for (const r of lineRows) {
    let p = byProduct.get(r.product_id);
    if (!p) {
      p = { name: r.product_name, sellPrice: r.sell_price, lines: [], unpriced: 0, cost: 0 };
      byProduct.set(r.product_id, p);
    }
    const qty = Number(r.quantity);
    const unitCost = r.avg_cost === null ? null : Number(r.avg_cost);
    // ปัดต่อบรรทัดเป็นสตางค์ตอนแสดง แต่รวมด้วยค่าจริงแล้วค่อยปัด
    // (สูตรเดียวกับ trigger: ROUND(SUM(qty × avg_cost), 2))
    const lineCost = qty * (unitCost ?? 0);
    p.cost += lineCost;
    if (unitCost === null) p.unpriced += 1;
    p.lines.push({
      ingredientName: r.ingredient_name,
      quantity: r.quantity,
      unit: r.unit,
      unitCost: r.avg_cost,
      lineCost: r2(lineCost),
    });
  }

  const products: MenuCost[] = [...byProduct.entries()].map(([id, p]) => {
    const cost = Number(r2(p.cost)); // ปัด 2 ตำแหน่งเหมือน trigger
    const sell = Number(p.sellPrice);
    const fcPct = sell > 0 ? (cost / sell) * 100 : null;
    const over = fcPct !== null && fcPct > target;
    return {
      productId: id,
      productName: p.name,
      sellPrice: p.sellPrice,
      ingredientCost: r2(cost),
      foodCostPct: fcPct === null ? null : fcPct.toFixed(1),
      grossProfit: r2(sell - cost),
      status: over ? "over" : "ok",
      recommendedPrice:
        over && target > 0 ? String(Math.ceil(cost / (target / 100))) : null,
      unpricedCount: p.unpriced,
      lines: p.lines,
    };
  });

  return {
    targetPct,
    products,
    noRecipe: bare.map((b) => ({
      productId: b.id,
      productName: b.name,
      sellPrice: b.sell_price,
    })),
    modifiers: modRows.map((m) => ({
      modifierName: m.modifier_name,
      groupName: m.group_name,
      priceDelta: m.price_delta,
      cost: m.cost,
    })),
  };
}
