/**
 * อัตราการใช้ · วันที่เหลือ · ความต้องการจากการผลิต (Inventory I-5 / I-7 · pure)
 *
 * ═══ ที่มา ════════════════════════════════════════════════════════
 * สูตรทั้งหมดในไฟล์นี้ "ย้าย" มาจาก getShoppingList() เดิม (0085) เพื่อให้
 * ลิสต์ต้องซื้อ · การ์ดของผลิตเอง · ก้อน "ต้องผลิต" ใช้เลขชุดเดียวกัน — ไม่มีสูตร consumption ตัวที่สอง
 *
 * ═══ กติกา ════════════════════════════════════════════════════════
 *   usage      = Σ(-qty_change) ของ movement sale + production_input ในช่วง lookback (เซิร์ฟเวอร์ query มาให้)
 *   daily      = usage / lookback
 *   daysLeft   = daily > 0 ? floor(stock / daily) : null   ← ไม่มี Infinity/NaN · null = "ยังไม่มีข้อมูลการใช้เพียงพอ"
 *   suggested  = max(daily×7, threshold, targetStock) − stock (ไม่ติดลบ)          (เดิม)
 *   urgency    = critical: daysLeft ≤ 1 หรือ stock ≤ 50% threshold · low: daysLeft ≤ 3 หรือ stock ≤ threshold (เดิม)
 *
 *   C4 (SHORTFALL ONLY): ความต้องการจากการผลิตห้ามบวกกับ forecast
 *   production shortfall = max(required_for_planned_batches − current_stock, 0)
 *   suggested_final      = max(forecast, shortfall)   — ไม่ใช่ forecast + shortfall
 *   เหตุผล: usage ข้างบนนับ production_input อยู่แล้ว → forecast ของ Mayo มีการผลิตรวมอยู่แล้ว
 */

export type Urgency = "critical" | "low" | "ok";

export type UsageInput = {
  stock: number;
  /** ปริมาณที่ใช้ไปในช่วง lookback (หน่วยสต็อก) — ติดลบถือเป็น 0 */
  used: number;
  lookbackDays: number;
  lowStockThreshold: number | null;
  targetStock: number | null;
};

export type UsageStats = {
  used: number;
  daily: number;
  daysLeft: number | null;
  /** forecast เดิม (ยังไม่รวม production shortfall) */
  suggested: number;
  urgency: Urgency;
};

export function daysRemaining(stock: number, daily: number): number | null {
  if (!Number.isFinite(daily) || daily <= 0) return null;
  if (!Number.isFinite(stock)) return null;
  return Math.floor(Math.max(stock, 0) / daily);
}

export function urgencyOf(
  stock: number,
  daysLeft: number | null,
  threshold: number | null,
): Urgency {
  if ((daysLeft !== null && daysLeft <= 1) || (threshold !== null && stock <= threshold * 0.5)) {
    return "critical";
  }
  if ((daysLeft !== null && daysLeft <= 3) || (threshold !== null && stock <= threshold)) {
    return "low";
  }
  return "ok";
}

export function usageStats(input: UsageInput): UsageStats {
  const lookback = Math.max(input.lookbackDays, 1);
  const used = Math.max(Number.isFinite(input.used) ? input.used : 0, 0);
  const daily = used / lookback;
  const daysLeft = daysRemaining(input.stock, daily);
  const threshold = input.lowStockThreshold;

  // ควรมีให้พอ ~7 วัน (เผื่อ buffer) หรือเติมถึง threshold ถ้าตั้งไว้
  const target = Math.max(daily * 7, threshold ?? 0);
  const forecastSuggested = Math.max(target - input.stock, 0);
  // 0085: target_stock เป็นตัวเสริม ไม่ทับการพยากรณ์ — ใช้ค่าที่มากกว่า
  const suggested =
    input.targetStock == null
      ? forecastSuggested
      : Math.max(forecastSuggested, Math.max(input.targetStock - input.stock, 0));

  return { used, daily, daysLeft, suggested, urgency: urgencyOf(input.stock, daysLeft, threshold) };
}

/** C4: เลือกค่ามากกว่า ไม่บวก */
export function finalSuggested(forecast: number, productionShortfall: number): number {
  return Math.max(forecast, Math.max(productionShortfall, 0));
}

// ═══ ความต้องการจากการผลิต (I-7) ═══════════════════════════════════

export type DemandRecipe = {
  recipeId: string;
  recipeName: string;
  outputIngredientId: string;
  expectedOutputQty: number;
  inputs: {
    ingredientId: string;
    name: string;
    purchaseUnit: string;
    trackStock: boolean;
    /** ต่อ 1 batch — หน่วยสต็อกของ input */
    perBatch: number;
    /** สต็อกปัจจุบัน (null = ไม่นับสต็อก) */
    stock: number | null;
  }[];
};

export type ProductionDemandInput = {
  ingredientId: string;
  name: string;
  purchaseUnit: string;
  trackStock: boolean;
  perBatch: string;
  required: string;
  /** null = ไม่นับสต็อก (ไม่คิดขาด) */
  have: string | null;
  shortfall: string;
};

export type ProductionDemand = {
  outputIngredientId: string;
  outputName: string;
  recipeId: string;
  recipeName: string;
  expectedOutputQty: string;
  /** ปริมาณผลผลิตที่อยากได้เพิ่ม (suggested ของตัวผลิตเอง) */
  needQty: string;
  batchesNeeded: number;
  inputs: ProductionDemandInput[];
};

/** กี่ batch ถึงจะได้ needQty — อย่างน้อย 1 เมื่อถูกเรียก (ผู้เรียกตัดสินแล้วว่าต้องผลิต) */
export function batchesNeededFor(needQty: number, expectedOutputQty: number): number {
  if (!Number.isFinite(expectedOutputQty) || expectedOutputQty <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(needQty, 0) / expectedOutputQty));
}

const f4 = (n: number) => n.toFixed(4);

/** เช็คลิสต์ input ของการผลิต 1 สูตร × batches — ขาดคิดเทียบสต็อกตอนนี้ */
export function demandFor(
  recipe: DemandRecipe,
  outputName: string,
  needQty: number,
): ProductionDemand {
  const batches = batchesNeededFor(needQty, recipe.expectedOutputQty);
  return {
    outputIngredientId: recipe.outputIngredientId,
    outputName,
    recipeId: recipe.recipeId,
    recipeName: recipe.recipeName,
    expectedOutputQty: f4(recipe.expectedOutputQty),
    needQty: f4(Math.max(needQty, 0)),
    batchesNeeded: batches,
    inputs: recipe.inputs.map((inp) => {
      const required = inp.perBatch * batches;
      const have = inp.trackStock && inp.stock != null ? inp.stock : null;
      const shortfall = have == null ? 0 : Math.max(required - Math.max(have, 0), 0);
      return {
        ingredientId: inp.ingredientId,
        name: inp.name,
        purchaseUnit: inp.purchaseUnit,
        trackStock: inp.trackStock,
        perBatch: f4(inp.perBatch),
        required: f4(required),
        have: have == null ? null : f4(have),
        shortfall: f4(shortfall),
      };
    }),
  };
}

/**
 * ขาดรวมต่อ input เมื่อหลายสูตรใช้ของก้อนเดียวกัน:
 * Σ required ทุก demand − stock (ครั้งเดียว) — ไม่ใช่ Σ shortfall ต่อ demand (จะหักสต็อกซ้ำ)
 */
export function totalShortfallByInput(
  demands: ProductionDemand[],
  stockOf: (ingredientId: string) => number | null,
): Map<string, number> {
  const required = new Map<string, number>();
  for (const d of demands) {
    for (const inp of d.inputs) {
      if (!inp.trackStock) continue;
      required.set(inp.ingredientId, (required.get(inp.ingredientId) ?? 0) + Number(inp.required));
    }
  }
  const out = new Map<string, number>();
  for (const [id, req] of required) {
    const stock = stockOf(id);
    if (stock == null) continue;
    out.set(id, Math.max(req - Math.max(stock, 0), 0));
  }
  return out;
}
