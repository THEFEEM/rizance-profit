/**
 * กำลังการผลิตจากสูตรจริง (Inventory I-4 · สเปก §6)
 *
 * ═══ คำถามที่ตอบ ═══════════════════════════════════════════════
 *   Ketchup เหลือ 2,000g · สูตรใช้ 660g/batch → ทำได้ 3 batch
 *   Homemade Sauce ผลิตได้สูงสุดกี่ batch · ตัวจำกัดคือใคร (น้ำตาลทำได้ 2 → ทั้งสูตรทำได้ 2)
 *
 * ═══ กติกา ═══════════════════════════════════════════════════════
 *   · input ที่ไม่นับสต็อก (track_stock=false) ข้าม — "ไม่จำกัด" ไม่ใช่ "ทำได้ 0"
 *   · สต็อกติดลบถือเป็น 0 (ข้อมูลผิด ไม่ใช่หนี้ · ทำได้ 0 batch จนกว่าจะตรวจนับ)
 *   · ไม่มี input ที่นับสต็อกเลย / สูตรว่าง → maxBatches = null ("ไม่ทราบ" ไม่ใช่ 0)
 *   · perBatch เป็นหน่วยสต็อกแล้ว (fn_recipe_qty_in_purchase_unit) — ห้ามส่งหน่วยใช้งานดิบมา
 *   · bottleneck = input ที่ทำได้น้อยที่สุด · เท่ากันหลายตัว → ตัวที่สัดส่วน stock/perBatch ต่ำสุด
 *     (ใกล้หมดกว่า) · ยังเท่ากันอีก → ตัวแรกตามลำดับสูตร
 *
 * pure ทั้งไฟล์ — ไม่มี DB/IO · เทสตรง ๆ ได้
 */

export type CapacityInput = {
  ingredientId: string;
  ingredientName: string;
  /** ปริมาณที่สูตรใช้ต่อ 1 batch — หน่วยสต็อกของวัตถุดิบ */
  perBatch: number;
  /** สต็อกปัจจุบัน (หน่วยสต็อก) · null = ไม่นับสต็อก */
  stock: number | null;
};

export type CapacityBottleneck = {
  ingredientId: string;
  ingredientName: string;
  /** batch ที่ input ตัวนี้รองรับได้ */
  batches: number;
};

export type RecipeCapacity = {
  /** batch ที่ผลิตได้ตอนนี้ · null = ไม่ทราบ (ไม่มี input ที่นับสต็อก) */
  maxBatches: number | null;
  bottleneck: CapacityBottleneck | null;
  /** batch ต่อ input · null = input นี้ไม่นับสต็อก/สูตรระบุ 0 */
  perInput: { ingredientId: string; batches: number | null }[];
};

/** batch ที่ input ตัวเดียวรองรับ — null เมื่อไม่นับสต็อกหรือสูตรใช้ 0 */
export function batchesFor(input: CapacityInput): number | null {
  if (input.stock == null) return null;
  if (!Number.isFinite(input.perBatch) || input.perBatch <= 0) return null;
  const stock = Number.isFinite(input.stock) ? Math.max(input.stock, 0) : 0;
  // + epsilon กันทศนิยมลอย: 1.2 kg / 0.2 kg = 5.999999… ต้องได้ 6 ไม่ใช่ 5
  return Math.floor(stock / input.perBatch + 1e-9);
}

export function computeCapacity(inputs: CapacityInput[]): RecipeCapacity {
  const perInput = inputs.map((i) => ({ ingredientId: i.ingredientId, batches: batchesFor(i) }));

  let best: { input: CapacityInput; batches: number; ratio: number } | null = null;
  inputs.forEach((input, idx) => {
    const batches = perInput[idx].batches;
    if (batches == null) return;
    const ratio = Math.max(input.stock ?? 0, 0) / input.perBatch;
    if (
      best === null ||
      batches < best.batches ||
      (batches === best.batches && ratio < best.ratio)
    ) {
      best = { input, batches, ratio };
    }
  });

  if (best === null) return { maxBatches: null, bottleneck: null, perInput };
  const b: { input: CapacityInput; batches: number; ratio: number } = best;
  return {
    maxBatches: b.batches,
    bottleneck: {
      ingredientId: b.input.ingredientId,
      ingredientName: b.input.ingredientName,
      batches: b.batches,
    },
    perInput,
  };
}
