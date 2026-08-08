import { centsToDecimalString, toCents } from "@/lib/money";

/**
 * กระจายราคาคอมโบลงบรรทัดสินค้าจริง (0071)
 *
 * โจทย์: คอมโบ ฿109 ที่ประกอบจาก Smash ฿69 + ฟราย ฿35 + น้ำ ฿35 (ป้ายรวม ฿139)
 *        ต้องกลายเป็น "บรรทัดสินค้าจริง 3 บรรทัด" ที่รวมกันได้ ฿109 เป๊ะ
 *
 * ทำไมไม่เก็บเป็นบรรทัดเดียวชื่อ "คอมโบ":
 *   - ตัดสต๊อก/วัตถุดิบรายสินค้าไม่ได้
 *   - รายงานสินค้าขายดีจะไม่นับฟรายกับน้ำเลย (หายเข้าไปในคำว่า "คอมโบ")
 *   - ซึ่งแปลว่าเราจะมองไม่เห็นว่าคอมโบทำให้ฟรายขายออกจริงไหม = วัดผลไม่ได้
 *
 * ⚠️ หัวใจคือ "เศษสตางค์ต้องไม่หาย"
 *    109 ÷ 139 เป็นทศนิยมไม่ลงตัว ถ้าปัดทีละบรรทัดแล้วบวกกัน จะได้ 108.99 หรือ 109.01
 *    ซึ่งจะทำให้ Σ line_total ≠ total_amount → invariant พัง → journal ไม่บาลานซ์
 *
 *    วิธีแก้: คำนวณเป็น "สตางค์" (จำนวนเต็ม) ทุกขั้น แล้วโยนเศษที่เหลือทั้งหมด
 *    ให้บรรทัดที่แพงที่สุด (ไม่ใช่บรรทัดสุดท้าย — บรรทัดแพงสุดรับเศษ 1-2 สตางค์
 *    แล้วเปอร์เซ็นต์ส่วนลดเพี้ยนน้อยที่สุด และลูกค้าสังเกตไม่เห็น)
 */

export type ComboComponent = {
  productId: string;
  /** ราคาป้ายต่อหน่วย ณ เวลาขาย */
  listUnitPrice: string;
  /** จำนวนต่อคอมโบ 1 ชุด */
  quantity: number;
};

export type AllocatedComponent = ComboComponent & {
  /** ราคาต่อหน่วยหลังกระจายส่วนลดคอมโบแล้ว */
  sellUnitPrice: string;
  /** listUnitPrice × quantity */
  lineList: string;
  /** sellUnitPrice × quantity — Σ ของทุกบรรทัด = ราคาคอมโบเป๊ะ */
  lineTotal: string;
};

export class PosComboEmptyError extends Error {
  constructor() {
    super("combo_empty");
  }
}

export class PosComboPriceError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * @param comboPrice ราคาคอมโบต่อ 1 ชุด
 * @param comboQty   ลูกค้าสั่งคอมโบกี่ชุด
 */
export function allocateComboPrice(
  components: ComboComponent[],
  comboPrice: string,
  comboQty = 1,
): {
  lines: AllocatedComponent[];
  /** ราคาป้ายรวม (Gross) */
  listTotal: string;
  /** ราคาที่เก็บจริงรวม (Net) = comboPrice × comboQty */
  netTotal: string;
  /** ส่วนลดที่คอมโบนี้แจกไป = listTotal − netTotal */
  discount: string;
} {
  if (components.length === 0) throw new PosComboEmptyError();
  if (!Number.isInteger(comboQty) || comboQty < 1) {
    throw new PosComboPriceError("invalid_combo_qty");
  }

  // ทุกอย่างเป็นสตางค์จำนวนเต็มตั้งแต่บรรทัดนี้เป็นต้นไป
  const netCents = toCents(comboPrice) * comboQty;
  if (netCents <= 0) throw new PosComboPriceError("invalid_combo_price");

  const lineListCents = components.map((c) => {
    const cents = Math.round(toCents(c.listUnitPrice) * c.quantity * comboQty);
    if (cents < 0) throw new PosComboPriceError("invalid_component_price");
    return cents;
  });
  const listCents = lineListCents.reduce((a, b) => a + b, 0);

  if (listCents <= 0) throw new PosComboPriceError("invalid_component_price");
  if (netCents > listCents) {
    // คอมโบแพงกว่าซื้อแยก = ตั้งราคาผิด ไม่ควรปล่อยให้ขายออกไป
    throw new PosComboPriceError("combo_price_above_list");
  }

  // กระจายตามสัดส่วนราคาป้าย — ปัดลงก่อน แล้วค่อยแจกเศษ
  const allocated = lineListCents.map((cents) =>
    Math.floor((cents * netCents) / listCents),
  );
  let remainder = netCents - allocated.reduce((a, b) => a + b, 0);

  // เศษที่เหลือ (0..n-1 สตางค์) ยัดใส่บรรทัดที่ราคาป้ายสูงสุดก่อน
  const byValueDesc = lineListCents
    .map((cents, i) => ({ i, cents }))
    .sort((a, b) => b.cents - a.cents);
  let k = 0;
  while (remainder > 0) {
    allocated[byValueDesc[k % byValueDesc.length].i] += 1;
    remainder -= 1;
    k += 1;
  }

  const lines: AllocatedComponent[] = components.map((c, i) => {
    const unitsTotal = c.quantity * comboQty;
    const lineCents = allocated[i];
    // ราคาต่อหน่วยอาจมีทศนิยมเกิน 2 ตำแหน่งเมื่อหารกลับ — เก็บ line_total เป็นความจริง
    // แล้วให้ unit price เป็นค่าที่ปัดเพื่อ "แสดงผล" เท่านั้น
    const unitCents = unitsTotal > 0 ? Math.round(lineCents / unitsTotal) : lineCents;
    return {
      ...c,
      sellUnitPrice: centsToDecimalString(unitCents),
      lineList: centsToDecimalString(lineListCents[i]),
      lineTotal: centsToDecimalString(lineCents),
    };
  });

  // กันพลาดขั้นสุดท้าย: ถ้าเศษยังไม่ลงตัวแปลว่าโค้ดด้านบนผิด อย่าปล่อยผ่านเด็ดขาด
  const sum = lines.reduce((acc, l) => acc + toCents(l.lineTotal), 0);
  if (sum !== netCents) {
    throw new PosComboPriceError(
      `combo_allocation_mismatch: ${sum} !== ${netCents}`,
    );
  }

  return {
    lines,
    listTotal: centsToDecimalString(listCents),
    netTotal: centsToDecimalString(netCents),
    discount: centsToDecimalString(listCents - netCents),
  };
}

/**
 * แต้มที่ลูกค้าได้จากยอดสุทธิ (0071)
 *
 *   มูลค่าที่คืน = net × loyalty_return_pct / 100
 *   แต้ม        = floor( มูลค่าที่คืน ÷ (point_value_satang / 100) )
 *
 * ตัวอย่างที่ตกลงกัน: net ฿100 · คืน 8% · 1 แต้ม = 10 สตางค์ → 80 แต้ม
 *
 * คำนวณด้วยสตางค์ล้วนเพื่อไม่ให้ floating point ทำให้ได้ 79 แต้มแทน 80
 * ปัดลงเสมอ — ร้านไม่ควรจ่ายแต้มมากกว่าที่ตั้งใจแม้แต่แต้มเดียว
 */
export function pointsFromNet(
  netAmount: string,
  opts: { loyaltyReturnPct: number; pointValueSatang: number },
): number {
  const { loyaltyReturnPct, pointValueSatang } = opts;
  if (loyaltyReturnPct <= 0 || pointValueSatang <= 0) return 0;

  const netCents = toCents(netAmount);
  if (netCents <= 0) return 0;

  // netCents (สตางค์) × pct → หน่วยเป็น "สตางค์ × เปอร์เซ็นต์"
  const returnSatangX100 = netCents * loyaltyReturnPct;
  // ÷ 100 (แปลง % เป็นสัดส่วน) ÷ pointValueSatang (สตางค์ต่อแต้ม)
  return Math.floor(returnSatangX100 / 100 / pointValueSatang);
}

/**
 * แปลงกลับ: แต้มนี้คิดเป็นเงินเท่าไหร่
 * ใช้โชว์ "Point Liability" ให้เจ้าของร้านเห็นว่าค้างจ่ายอยู่กี่บาท (ข้อ 19)
 */
export function pointsToBaht(points: number, pointValueSatang: number): string {
  if (points <= 0 || pointValueSatang <= 0) return "0.00";
  return centsToDecimalString(points * pointValueSatang);
}
