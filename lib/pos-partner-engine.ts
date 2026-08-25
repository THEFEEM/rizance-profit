/**
 * Partner Benefit Engine (0086) — pure function เทสได้โดยไม่ต่อ DB
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) คิดเป็น "สตางค์" ทั้งหมด — ไม่มี float ลอยอยู่ในสูตรเลย
 * 2) ปกป้องมาร์จิ้นเป็นอันดับแรก: ปัดเศษเข้าข้างร้านเสมอ (ceil)
 * 3) บรรทัดไหนคำนวณไม่ได้ = ไม่ลด ไม่ใช่ทั้งบิลพัง
 * 4) ฟังก์ชันนี้ไม่รู้จัก DB / ไม่รู้จักชื่อหุ้นส่วน — รับตัวเลขล้วน
 *
 * ═══ สูตร (ตามสเปคข้อ 3) ═══════════════════════════════════════
 *   floor     = ต้นทุน + กำไรขั้นต่ำ × จำนวน
 *   candidate = ราคาปกติ × (1 − ส่วนลดสูงสุด%)
 *   ราคาหุ้นส่วน = min(ราคาปกติ, max(floor, candidate))
 *
 * max() คือด่านกันขาดทุน · min() กันไม่ให้ "ส่วนลด" กลายเป็นราคาแพงขึ้น
 */

export type PartnerEngineLine = {
  index: number;
  /** ราคาสุทธิปัจจุบันของบรรทัด (หลังคอมโบแล้ว) เป็นสตางค์ */
  lineTotalCents: number;
  /** ต้นทุนรวมของบรรทัด เป็นสตางค์ — 0 หรือติดลบ = ไม่มีต้นทุนที่เชื่อถือได้ */
  lineCostCents: number;
  qty: number;
  /** บรรทัดนี้มีส่วนลดอื่นอยู่แล้วไหม (คอมโบ) */
  alreadyDiscounted: boolean;
};

export type PartnerSettings = {
  /** กำไรขั้นต่ำต่อ 1 ชิ้น (สตางค์) */
  minProfitPerItemCents: number;
  /** ลดได้สูงสุดกี่ % ของราคาปกติ */
  maxDiscountPercent: number;
  /** true = ยอมขายต่ำกว่าทุน (ค่าตั้งต้นคือ false และควรอยู่แบบนั้น) */
  allowBelowCost: boolean;
};

export type PartnerLineResult = {
  index: number;
  /** ส่วนลดของบรรทัดนี้ (สตางค์) — 0 = ไม่ได้ลด */
  discountCents: number;
  newLineTotalCents: number;
  /** ทำไมถึงไม่ลด — null = ลดได้ปกติ */
  skipReason: null | "no_cost" | "already_discounted" | "no_room";
};

export type PartnerEvaluation = {
  lines: PartnerLineResult[];
  regularTotalCents: number;
  paidTotalCents: number;
  discountTotalCents: number;
  costTotalCents: number;
  /** กำไรที่ร้านยังเหลือหลังให้สิทธิ์ = จ่ายจริง − ต้นทุน */
  contributionCents: number;
  /** จำนวนบรรทัดที่ลดไม่ได้ พร้อมเหตุผล — เอาไปบอกผู้ใช้ตรง ๆ */
  skipped: { index: number; reason: NonNullable<PartnerLineResult["skipReason"]> }[];
};

/**
 * คำนวณสิทธิ์หุ้นส่วนทั้งตะกร้า
 *
 * ⚠️ ตัวเลขที่คืนออกไปคือความจริงเพียงชุดเดียว — ฝั่ง client ห้ามส่งส่วนลด
 *    หรือต้นทุนเข้ามา และห้ามนำค่าจาก client มาคำนวณต่อ
 */
export function evaluatePartnerBenefit(
  lines: PartnerEngineLine[],
  settings: PartnerSettings,
): PartnerEvaluation {
  const pct = clampPercent(settings.maxDiscountPercent);
  const minProfit = Math.max(0, Math.round(settings.minProfitPerItemCents));

  const results: PartnerLineResult[] = lines.map((l) => {
    const normal = Math.max(0, Math.round(l.lineTotalCents));

    // บรรทัดที่มีส่วนลดอื่นแล้ว — ไม่ลดซ้อน (กติกาเดียวกับแคมเปญ ดู 0074)
    if (l.alreadyDiscounted) {
      return { index: l.index, discountCents: 0, newLineTotalCents: normal,
               skipReason: "already_discounted" };
    }

    // ไม่มีต้นทุนที่เชื่อถือได้ → ห้ามเดา ห้ามลด (สเปคข้อ 4)
    // เกิดกับเมนูที่ยังไม่ได้ผูกสูตรวัตถุดิบ (cost_price = 0)
    if (!(l.lineCostCents > 0)) {
      return { index: l.index, discountCents: 0, newLineTotalCents: normal,
               skipReason: "no_cost" };
    }

    const qty = Math.max(1, Math.round(l.qty));
    // ปิดสวิตช์กันขาดทุน = เจ้าของยอมรับความเสี่ยงเอง (ค่าตั้งต้นคือปิดไว้)
    const floor = settings.allowBelowCost
      ? 0
      : Math.round(l.lineCostCents) + minProfit * qty;

    // ปัดขึ้นเข้าข้างร้าน — เศษสตางค์ต้องไม่กินมาร์จิ้น
    const candidate = Math.ceil((normal * (100 - pct)) / 100);
    const price = Math.min(normal, Math.max(floor, candidate));
    const discount = Math.max(0, normal - price);

    return {
      index: l.index,
      discountCents: discount,
      newLineTotalCents: normal - discount,
      // ราคาชนเพดานล่างอยู่แล้ว = ไม่มีที่ให้ลด (เมนูมาร์จิ้นบาง)
      skipReason: discount === 0 ? "no_room" : null,
    };
  });

  const regularTotalCents = sum(lines.map((l) => Math.max(0, Math.round(l.lineTotalCents))));
  const discountTotalCents = sum(results.map((r) => r.discountCents));
  const paidTotalCents = regularTotalCents - discountTotalCents;
  const costTotalCents = sum(lines.map((l) => Math.max(0, Math.round(l.lineCostCents))));

  return {
    lines: results,
    regularTotalCents,
    paidTotalCents,
    discountTotalCents,
    costTotalCents,
    contributionCents: paidTotalCents - costTotalCents,
    skipped: results
      .filter((r) => r.skipReason !== null)
      .map((r) => ({ index: r.index, reason: r.skipReason! })),
  };
}

/**
 * ตรวจซ้ำว่าไม่มีบรรทัดไหนหลุดต่ำกว่าเพดานล่าง
 *
 * เรียกหลังคำนวณเสมอ — ถ้าคืน false แปลว่ามีบั๊กในเครื่องคิดเลข
 * ให้ยกเลิกทั้งรายการดีกว่าปล่อยบิลขาดทุนออกไป
 */
export function assertMarginSafe(
  lines: PartnerEngineLine[],
  results: PartnerLineResult[],
  settings: PartnerSettings,
): boolean {
  if (settings.allowBelowCost) return true;
  const minProfit = Math.max(0, Math.round(settings.minProfitPerItemCents));
  const byIndex = new Map(results.map((r) => [r.index, r]));
  for (const l of lines) {
    const r = byIndex.get(l.index);
    if (!r || r.discountCents === 0) continue;
    const qty = Math.max(1, Math.round(l.qty));
    const floor = Math.round(l.lineCostCents) + minProfit * qty;
    if (r.newLineTotalCents < floor) return false;
  }
  return true;
}

/** ข้อความอธิบายให้ผู้ใช้อ่าน — ไม่ใช้ในการคำนวณ */
export const PARTNER_SKIP_TEXT: Record<
  NonNullable<PartnerLineResult["skipReason"]>,
  string
> = {
  no_cost: "ยังไม่ได้ผูกสูตร — คำนวณราคาหุ้นส่วนไม่ได้",
  already_discounted: "มีส่วนลดอื่นอยู่แล้ว",
  no_room: "ราคาชนกำไรขั้นต่ำแล้ว ลดต่อไม่ได้",
};

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
