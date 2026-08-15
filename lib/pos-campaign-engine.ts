import { centsToDecimalString, toCents } from "@/lib/money";

/**
 * Ninenon Campaign Engine (0074) — pure functions ล้วน ไม่แตะ DB
 *
 * แยกออกมาเพื่อ: เทสได้โดยไม่ต่อ DB · reuse ได้ทั้ง POS/QR/online ในอนาคต
 * · การตัดสินใจเรื่องเงินทั้งหมดรวมอยู่ไฟล์เดียว อ่านออกใน 5 นาที
 *
 * ═══ กฎเงินที่บังคับที่นี่ ═══════════════════════════════════
 * 1) คิดเป็นสตางค์ (integer) เท่านั้น — floating point ห้ามเข้าใกล้เงิน
 * 2) ส่วนลด ≤ ยอด eligible เสมอ (fixed 20 บนบิล 15 → ลด 15 ไม่ใช่ติดลบ)
 * 3) กระจายส่วนลดรายบรรทัดแบบ pro-rata + เศษให้บรรทัดแพงสุด
 *    (pattern เดียวกับ pos-combo-pricing) + guard ผลรวมต้องตรงเป๊ะ
 * 4) เหตุผลปฏิเสธเป็น machine-readable code — client แปลเป็นภาษาคนเอง
 */

export type CampaignRule = {
  id: string;
  name: string;
  code: string | null;
  status: "draft" | "active" | "paused" | "archived";
  discountType: "percentage" | "fixed" | "buy_x_get_y" | "free_item";
  /** decimal string เช่น "10.00" */
  discountValue: string;
  scope: "entire_order" | "products";
  /** product ids เมื่อ scope = products */
  productIds: string[];
  minimumOrderAmount: string;
  maximumDiscountAmount: string | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  usedCount: number;
  startAt: string | null;
  endAt: string | null;
  timeStartMin: number | null;
  timeEndMin: number | null;
  daysOfWeek: string | null;
  eligibility: "all" | "members";
};

export type CampaignRejectReason =
  | "CAMPAIGN_NOT_ACTIVE"
  | "CAMPAIGN_NOT_STARTED"
  | "CAMPAIGN_EXPIRED"
  | "OUTSIDE_TIME_WINDOW"
  | "WRONG_DAY_OF_WEEK"
  | "MEMBER_REQUIRED"
  | "MINIMUM_ORDER_NOT_REACHED"
  | "USAGE_LIMIT_REACHED"
  | "CUSTOMER_USAGE_LIMIT_REACHED"
  | "NO_ELIGIBLE_ITEMS"
  | "UNSUPPORTED_DISCOUNT_TYPE";

/** บรรทัดในตะกร้า (มุมมองของ engine — ไม่รู้จัก DB) */
export type EngineLine = {
  /** index อ้างกลับไปหา computedLines ของผู้เรียก */
  index: number;
  productId: string | null;
  /** line_total ปัจจุบัน (หลังคอมโบแล้วถ้ามี) */
  lineTotalCents: number;
  /** บรรทัดที่มีส่วนลดอยู่แล้ว (combo) — MVP ไม่ลดซ้อน (ดู audit ข้อ conflicts) */
  alreadyDiscounted: boolean;
};

export type CampaignEvaluation =
  | {
      valid: true;
      campaignId: string;
      /** ส่วนลดรวม (บาท string) */
      discountAmount: string;
      /** ส่วนลดเป็นสตางค์รายบรรทัด — index ตรงกับ EngineLine.index · เฉพาะบรรทัดที่ถูกลด */
      perLineDiscountCents: Map<number, number>;
      /** ยอด eligible ที่ใช้เป็นฐานคำนวณ (บาท string) — โชว์ให้พนักงานเห็น */
      eligibleAmount: string;
    }
  | { valid: false; reason: CampaignRejectReason };

export class CampaignAllocationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CampaignAllocationError";
  }
}

/** นาทีจากเที่ยงคืน + วันในสัปดาห์ ตามเวลาไทย (ห้ามใช้ local TZ ของ server) */
export function bangkokClock(now: Date): { minuteOfDay: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minuteOfDay: hour * 60 + minute, dayOfWeek: dayMap[get("weekday")] ?? 0 };
}

/**
 * ตรวจเงื่อนไข + คำนวณส่วนลด — จุดตัดสินเดียวของทั้งระบบ
 *
 * ⚠️ usage limit ที่นี่เป็นแค่ pre-check ให้ UX ดี (บอกก่อนกดเก็บเงิน)
 *    การบังคับจริงอยู่ที่ atomic UPDATE ใน recordCampaignUsage — DB คือคนตัดสิน
 */
export function evaluateCampaign(args: {
  campaign: CampaignRule;
  lines: EngineLine[];
  /** จำนวนครั้งที่สมาชิกคนนี้ใช้ไปแล้ว (query มาก่อน) — null = ไม่ใช่สมาชิก */
  customerUsedCount: number | null;
  hasMember: boolean;
  now?: Date;
}): CampaignEvaluation {
  const { campaign: c, lines, customerUsedCount, hasMember } = args;
  const now = args.now ?? new Date();

  // ── สถานะ + ช่วงเวลา ─────────────────────────────────────
  if (c.status !== "active") return { valid: false, reason: "CAMPAIGN_NOT_ACTIVE" };
  if (c.startAt && now < new Date(c.startAt)) {
    return { valid: false, reason: "CAMPAIGN_NOT_STARTED" };
  }
  if (c.endAt && now > new Date(c.endAt)) {
    return { valid: false, reason: "CAMPAIGN_EXPIRED" };
  }

  if (c.timeStartMin !== null || c.timeEndMin !== null || c.daysOfWeek) {
    const clock = bangkokClock(now);
    if (c.daysOfWeek && !c.daysOfWeek.includes(String(clock.dayOfWeek))) {
      return { valid: false, reason: "WRONG_DAY_OF_WEEK" };
    }
    const s = c.timeStartMin ?? 0;
    const e = c.timeEndMin ?? 1440;
    // ช่วงข้ามเที่ยงคืน (22:00–02:00) รองรับด้วย: s > e = wrap
    const inWindow = s <= e
      ? clock.minuteOfDay >= s && clock.minuteOfDay < e
      : clock.minuteOfDay >= s || clock.minuteOfDay < e;
    if (!inWindow) return { valid: false, reason: "OUTSIDE_TIME_WINDOW" };
  }

  // ── eligibility ──────────────────────────────────────────
  if (c.eligibility === "members" && !hasMember) {
    return { valid: false, reason: "MEMBER_REQUIRED" };
  }

  // ── usage limits (pre-check) ─────────────────────────────
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) {
    return { valid: false, reason: "USAGE_LIMIT_REACHED" };
  }
  if (
    c.usageLimitPerCustomer !== null &&
    customerUsedCount !== null &&
    customerUsedCount >= c.usageLimitPerCustomer
  ) {
    return { valid: false, reason: "CUSTOMER_USAGE_LIMIT_REACHED" };
  }
  // per-customer limit + ไม่ใช่สมาชิก: บังคับไม่ได้ (ไม่รู้ว่าใคร) → ต้องเป็นสมาชิก
  if (c.usageLimitPerCustomer !== null && customerUsedCount === null) {
    return { valid: false, reason: "MEMBER_REQUIRED" };
  }

  // ── ยอดขั้นต่ำ: คิดจากสินค้าทั้งบิล (ไม่รวมค่าส่ง — ผู้เรียกกรองมาแล้ว) ──
  const orderCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  if (orderCents < toCents(c.minimumOrderAmount)) {
    return { valid: false, reason: "MINIMUM_ORDER_NOT_REACHED" };
  }

  // ── บรรทัด eligible ──────────────────────────────────────
  const productSet = new Set(c.productIds);
  const eligible = lines.filter((l) => {
    if (l.alreadyDiscounted) return false; // MVP: ไม่ลดซ้อนบนคอมโบ
    if (c.scope === "products") return l.productId !== null && productSet.has(l.productId);
    return true;
  });
  const eligibleCents = eligible.reduce((s, l) => s + l.lineTotalCents, 0);
  if (eligible.length === 0 || eligibleCents <= 0) {
    return { valid: false, reason: "NO_ELIGIBLE_ITEMS" };
  }

  // ── คำนวณส่วนลด ──────────────────────────────────────────
  let discountCents: number;
  if (c.discountType === "percentage") {
    // ปัด "ลง" เข้าข้างร้าน — สม่ำเสมอกับ pointsFromNet ของระบบแต้ม
    discountCents = Math.floor((eligibleCents * toCents(c.discountValue)) / 10000);
  } else if (c.discountType === "fixed") {
    discountCents = toCents(c.discountValue);
  } else {
    return { valid: false, reason: "UNSUPPORTED_DISCOUNT_TYPE" };
  }

  if (c.maximumDiscountAmount !== null) {
    discountCents = Math.min(discountCents, toCents(c.maximumDiscountAmount));
  }
  discountCents = Math.min(discountCents, eligibleCents); // ห้ามลดเกินยอด
  if (discountCents <= 0) return { valid: false, reason: "NO_ELIGIBLE_ITEMS" };

  // ── กระจายรายบรรทัด pro-rata · เศษ→บรรทัดแพงสุด ─────────
  const perLine = new Map<number, number>();
  let allocated = 0;
  for (const l of eligible) {
    const share = Math.floor((l.lineTotalCents * discountCents) / eligibleCents);
    perLine.set(l.index, share);
    allocated += share;
  }
  let remainder = discountCents - allocated;
  const byValueDesc = [...eligible].sort((a, b) => b.lineTotalCents - a.lineTotalCents);
  let k = 0;
  while (remainder > 0) {
    const line = byValueDesc[k % byValueDesc.length];
    // บรรทัดรับเพิ่มได้ไม่เกินยอดตัวเอง (fixed ใหญ่ + บรรทัดเล็กหลายบรรทัด)
    if ((perLine.get(line.index) ?? 0) < line.lineTotalCents) {
      perLine.set(line.index, (perLine.get(line.index) ?? 0) + 1);
      remainder -= 1;
    }
    k += 1;
    if (k > eligible.length * (discountCents + 1)) {
      throw new CampaignAllocationError("campaign_allocation_stuck");
    }
  }

  // guard: ผลรวมต้องเท่าส่วนลดเป๊ะ — เพี้ยน 1 สตางค์ = โยนทิ้งทั้ง transaction
  const sum = [...perLine.values()].reduce((a, b) => a + b, 0);
  if (sum !== discountCents) {
    throw new CampaignAllocationError(`campaign_allocation_mismatch: ${sum} !== ${discountCents}`);
  }

  return {
    valid: true,
    campaignId: c.id,
    discountAmount: centsToDecimalString(discountCents),
    perLineDiscountCents: perLine,
    eligibleAmount: centsToDecimalString(eligibleCents),
  };
}

/** สถานะที่คำนวณแล้วสำหรับโชว์ (expired ไม่เก็บใน DB — ดูเหตุผลใน 0074) */
export function displayStatus(
  c: Pick<CampaignRule, "status" | "startAt" | "endAt">,
  now = new Date(),
): "draft" | "active" | "scheduled" | "paused" | "expired" | "archived" {
  if (c.status !== "active") return c.status;
  if (c.startAt && now < new Date(c.startAt)) return "scheduled";
  if (c.endAt && now > new Date(c.endAt)) return "expired";
  return "active";
}
