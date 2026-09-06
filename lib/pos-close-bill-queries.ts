import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { businessDate } from "@/lib/date";
import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";
import {
  recordCampaignUsage,
  validateCampaignForCart,
} from "@/lib/pos-campaign-queries";
import type { CampaignRejectReason, EngineLine } from "@/lib/pos-campaign-engine";
import { applyPartnerBenefit, type PartnerApplied } from "@/lib/pos-partner-queries";
import type { PartnerEngineLine } from "@/lib/pos-partner-engine";
import { isPosPlanAllowed } from "@/lib/pos-config";
import { resolveActivePlan } from "@/lib/subscription-plan";
import { lockShopUser } from "@/lib/shop-profit-withdrawal-queries";
import { postPosBillJournal } from "@/lib/pos-posting-adapter";
import { resolveCartModifiers, type SelectedModifier } from "@/lib/pos-modifier-queries";
import { deductIngredientsForBill } from "@/lib/pos-ingredient-queries";
import {
  PosInvalidPhoneError,
  earnPointsForBill,
  upsertPosMember,
} from "@/lib/pos-member-queries";
import { expandComboToLines } from "@/lib/pos-combo-queries";
import {
  PosVoucherRejectedError,
  redeemAppliedVoucherInTx,
  validateVoucherForCart,
  type ValidatedVoucher,
} from "@/lib/pos-voucher-queries";
import type {
  ClosePosBillInput,
  ClosePosBillResult,
  PosBill,
  PosBillItem,
  PosPaymentMethod,
} from "@/types/pos";

/**
 * POS bills use cash|promptpay; shop income_entries only has cash|transfer
 * (on-hand buckets). PromptPay QR settles to the transfer bucket.
 */
export const POS_TO_INCOME_PAYMENT_METHOD: Record<PosPaymentMethod, "cash" | "transfer"> = {
  cash: "cash",
  promptpay: "transfer",
  thai_chuay_thai: "transfer",
};

export class PosPaymentMismatchError extends Error {
  constructor() {
    super("pos payments do not sum to bill total");
    this.name = "PosPaymentMismatchError";
  }
}

type UserSubRow = {
  subscription_plan: string;
  subscription_expires_at: Date | string | null;
};

type ProductRow = {
  id: string;
  name: string;
  sell_price: string;
  cost_price: string;
  stock_qty: string;
  track_stock: boolean;
};

type BillRow = {
  id: string;
  user_id: string;
  bill_no: string;
  status: string;
  total_amount: string;
  payment_method: string;
  entry_date: string;
  income_entry_id: string | null;
  created_at: Date | string;
};

type BillItemRow = {
  id: string;
  bill_id: string;
  product_id: string | null;
  product_name: string;
  unit_sell_price: string;
  unit_cost_price: string;
  quantity: string;
  line_total: string;
  line_cost: string;
  sort_order: number;
  note: string | null;
};

export class PosPlanRequiredError extends Error {
  constructor() {
    super("pos plan required");
    this.name = "PosPlanRequiredError";
  }
}

export class PosProductNotFoundError extends Error {
  constructor(public productIds: string[]) {
    super("pos product not found");
    this.name = "PosProductNotFoundError";
  }
}

/** ผูกบิลเข้าออเดอร์ไม่สำเร็จ (ออเดอร์ถูกยกเลิก หรือมีบิลอยู่แล้ว) → ทั้งบิล rollback */
export class PosOrderLinkFailedError extends Error {
  constructor() {
    super("could not link bill to order");
    this.name = "PosOrderLinkFailedError";
  }
}

export class PosEmptyCartError extends Error {
  constructor() {
    super("pos cart empty");
    this.name = "PosEmptyCartError";
  }
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapBill(r: BillRow): PosBill {
  return {
    id: r.id,
    userId: r.user_id,
    billNo: r.bill_no,
    status: r.status as PosBill["status"],
    totalAmount: r.total_amount,
    paymentMethod: r.payment_method as PosBill["paymentMethod"],
    entryDate: r.entry_date,
    incomeEntryId: r.income_entry_id,
    createdAt: toIso(r.created_at),
  };
}

function mapBillItem(r: BillItemRow): PosBillItem {
  return {
    id: r.id,
    billId: r.bill_id,
    productId: r.product_id,
    productName: r.product_name,
    unitSellPrice: r.unit_sell_price,
    unitCostPrice: r.unit_cost_price,
    quantity: r.quantity,
    lineTotal: r.line_total,
    lineCost: r.line_cost,
    sortOrder: r.sort_order,
    note: r.note,
  };
}

function formatBillNo(counterDate: string, seq: number): string {
  const ymd = counterDate.replace(/-/g, "");
  return `${ymd}-${String(seq).padStart(3, "0")}`;
}

function lineMoney(unitPrice: string, qty: number): string {
  const unitCents = toCents(unitPrice);
  const qtyScaled = Math.round(qty * 1000);
  const lineCents = Math.round((unitCents * qtyScaled) / 1000);
  return centsToDecimalString(lineCents);
}

async function assertPosSubscription(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<UserSubRow>(
    `SELECT subscription_plan, subscription_expires_at FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error("User not found");
  const plan = resolveActivePlan(row.subscription_plan, row.subscription_expires_at);
  if (!isPosPlanAllowed(plan)) {
    throw new PosPlanRequiredError();
  }
}

/**
 * เลขบิลถัดไป — self-healing เหมือน nextOrderNo
 *
 * ⚠️ บทเรียน 29 ก.ค. 69: pos_order_counters หลุดไปต่ำกว่าเลขที่ใช้แล้ว (6 vs 69)
 * → INSERT ชน UNIQUE (user_id, bill_no) → 500 → ร้านขายไม่ได้ทั้งวัน
 * pos_bill_counters มีช่องโหว่แบบเดียวกันเป๊ะ จึงยกพื้นเป็น MAX(เลขที่ใช้จริง) ก่อนบวกหนึ่ง
 *
 * ยิ่งจำเป็นหลังมี day cutoff: บิลที่ปิดหลังเที่ยงคืนไปใช้ counter ของ "วันก่อน"
 * ซึ่งมีเลขใช้ไปแล้วเยอะ ถ้า counter ไม่ตรงจะชนทันที
 */
async function nextBillNo(
  client: PoolClient,
  userId: string,
  counterDate: string,
): Promise<string> {
  const prefix = counterDate.replace(/-/g, "");

  await client.query(
    `INSERT INTO pos_bill_counters (user_id, counter_date, last_seq)
     VALUES ($1, $2::date, 0)
     ON CONFLICT (user_id, counter_date) DO NOTHING`,
    [userId, counterDate],
  );

  const { rows: updated } = await client.query<{ last_seq: number }>(
    `UPDATE pos_bill_counters c
     SET last_seq = GREATEST(
           c.last_seq,
           COALESCE((
             SELECT MAX(split_part(b.bill_no, '-', 2)::int)
             FROM pos_bills b
             WHERE b.user_id = $1
               AND b.bill_no LIKE $3 || '-%'
               AND b.bill_no ~ '^[0-9]{8}-[0-9]+$'
           ), 0)
         ) + 1
     WHERE c.user_id = $1 AND c.counter_date = $2::date
     RETURNING c.last_seq`,
    [userId, counterDate, prefix],
  );
  if (!updated[0]) throw new Error("pos bill counter missing after upsert");

  return formatBillNo(counterDate, updated[0].last_seq);
}

async function lockCartProducts(
  client: PoolClient,
  userId: string,
  productIds: string[],
): Promise<Map<string, ProductRow>> {
  const { rows } = await client.query<ProductRow>(
    `SELECT id, name, sell_price::text, cost_price::text, stock_qty::text, track_stock
     FROM pos_products
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_active = true
     ORDER BY id
     FOR UPDATE`,
    [userId, productIds],
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new PosProductNotFoundError(missing);
  }
  return byId;
}

/**
 * Atomic POS checkout: bill + items + stock + shop income_entries.
 * Rolls back entirely on any failure — client may retry with the same cart.
 */
/** Campaign ถูกปฏิเสธ — reason เป็น machine-readable code ให้ client แปลเอง */
export class PosCampaignRejectedError extends Error {
  constructor(public readonly reason: CampaignRejectReason) {
    super(`campaign_rejected:${reason}`);
    this.name = "PosCampaignRejectedError";
  }
}

export async function closePosBill(
  userId: string,
  input: ClosePosBillInput,
): Promise<ClosePosBillResult> {
  // ตะกร้าว่างจริง = ไม่มีทั้งสินค้าเดี่ยวและคอมโบ (เช็คซ้ำหลังกางคอมโบด้วย)
  if (input.items.length === 0 && (input.combos?.length ?? 0) === 0) {
    throw new PosEmptyCartError();
  }

  // วันที่บันทึกยอด = "วันขาย" ตาม cutoff ของร้าน (ไม่ใช่วันปฏิทินดิบ)
  // ร้านที่ปิดหลังเที่ยงคืนจะได้ยอดลงวันที่ถูกต้องเอง ไม่ต้องเลื่อนด้วย SQL
  const entryDate =
    input.entryDate ?? businessDate(await getDayCutoffHour(userId));
  const client = await pool.connect();
  const negativeStockProductIds: string[] = [];

  try {
    await client.query("BEGIN");

    await lockShopUser(client, userId);
    await assertPosSubscription(client, userId);

    const billNo = await nextBillNo(client, userId, entryDate);

    /**
     * คอมโบ → บรรทัดสินค้าจริง (0071)
     *
     * ⚠️ ราคาอ่านจาก DB ใน transaction นี้ (FOR UPDATE) ไม่เชื่อราคาที่ client ส่งมา
     * แต่ละคอมโบกระจายเป็นหลายบรรทัด แต่ละบรรทัดเป็นสินค้าจริง → ตัดสต๊อก/วัตถุดิบ
     * และนับในรายงานสินค้าขายดีได้เหมือนบรรทัดปกติทุกประการ
     */
    const comboExpanded: {
      productId: string;
      qty: number;
      unitSellPrice: string;
      lineTotal: string;
      listUnitPrice: string;
      comboId: string;
      comboName: string;
    }[] = [];
    for (const c of input.combos ?? []) {
      const ex = await expandComboToLines(client, userId, c.comboId, c.qty);
      for (const l of ex.lines) {
        comboExpanded.push({
          productId: l.productId,
          qty: l.quantity * c.qty,
          unitSellPrice: l.sellUnitPrice,
          lineTotal: l.lineTotal,
          listUnitPrice: l.listUnitPrice,
          comboId: c.comboId,
          comboName: ex.comboName,
        });
      }
    }

    if (input.items.length === 0 && comboExpanded.length === 0) {
      throw new PosEmptyCartError();
    }

    // ล็อกสินค้าทั้งของบรรทัดปกติและของคอมโบพร้อมกัน — กัน deadlock จากการล็อกสองรอบ
    const productIds = [
      ...input.items.map((i) => i.productId),
      ...comboExpanded.map((c) => c.productId),
    ];
    const products = await lockCartProducts(client, userId, productIds);

    // Modifiers: validate ownership/rules, price resolved server-side only.
    const modifiersByLine = await resolveCartModifiers(client, userId, input.items);

    type ComputedLine = {
      product: NonNullable<ReturnType<typeof products.get>>;
      qty: number;
      note: string | null;
      unitSellPrice: string;
      lineTotal: string;
      lineCost: string;
      sortOrder: number;
      selectedModifiers: SelectedModifier[];
      /** ราคาป้าย — NULL เมื่อไม่มีส่วนลด (บรรทัดปกติ) */
      listUnitPrice: string | null;
      discountSource: string | null;
      comboId: string | null;
      comboName: string | null;
    };

    const computedLines: ComputedLine[] = input.items.map((line, sortOrder) => {
      const product = products.get(line.productId)!;
      const selectedModifiers: SelectedModifier[] = modifiersByLine.get(sortOrder) ?? [];
      // Effective unit price = base + Σ delta (cents-safe). Stored in
      // unit_sell_price so SUM(line_total) = total_amount = journal — the
      // posting adapter stays untouched.
      const unitPriceCents =
        toCents(product.sell_price) +
        selectedModifiers.reduce((sum, m) => sum + toCents(m.priceDelta), 0);
      const unitSellPrice = centsToDecimalString(unitPriceCents);
      return {
        product,
        qty: line.qty,
        note: line.note?.trim() || null,
        unitSellPrice,
        lineTotal: lineMoney(unitSellPrice, line.qty),
        lineCost: lineMoney(product.cost_price, line.qty),
        sortOrder,
        selectedModifiers,
        listUnitPrice: null,
        discountSource: null,
        comboId: null,
        comboName: null,
      };
    });

    // บรรทัดจากคอมโบ — ไม่รับ modifier ในเวอร์ชันนี้ (ราคาถูกล็อกไว้แล้วจากการกระจาย)
    comboExpanded.forEach((c, i) => {
      const product = products.get(c.productId)!;
      computedLines.push({
        product,
        qty: c.qty,
        note: null,
        unitSellPrice: c.unitSellPrice,
        lineTotal: c.lineTotal,
        lineCost: lineMoney(product.cost_price, c.qty),
        sortOrder: input.items.length + i,
        selectedModifiers: [],
        listUnitPrice: c.listUnitPrice,
        discountSource: "combo",
        comboId: c.comboId,
        comboName: c.comboName,
      });
    });

    /**
     * ═══ Ninenon Campaign (0074) — จุดเดียวที่ส่วนลดแคมเปญเกิดขึ้น ═══
     *
     * ลำดับที่จงใจ: หลังคอมโบกางเสร็จ (ส่วนลดคอมโบฝังในบรรทัดแล้ว)
     * ก่อน surcharge/totalAmount — ส่วนลดจึง:
     *   · ไม่แตะค่าส่ง (surcharge ไม่เข้าฐานคำนวณ)
     *   · ฝังในราคาบรรทัดผ่าน list_unit_price + discount_source='coupon'
     *   · invariant Σ line_total = total_amount = journal ยังจริงโดยไม่แก้ posting
     *
     * ⚠️ Coupon = Revenue Reduction (การตัดสินใจธุรกิจที่ล็อกไว้):
     *    line_total ที่ลดแล้วไหลเข้ารายได้ตามปกติ = รายได้ลดจริง ไม่มี journal เพิ่ม
     */
    let campaignApplied: {
      campaignId: string;
      campaignName: string;
      couponCode: string | null;
      discountAmount: string;
      subtotalBefore: string;
      usageLimitPerCustomer: number | null;
      memberId: string | null;
    } | null = null;

    if (input.campaignId || input.couponCode) {
      // ตัวตนลูกค้าสำหรับ eligibility — ต้องรู้ "ก่อน" คิดส่วนลด
      let campaignMemberId: string | null = null;
      if (input.memberPhone) {
        try {
          const m = await upsertPosMember(
            userId,
            { phone: input.memberPhone, name: input.memberName ?? null },
            client,
          );
          campaignMemberId = m.id;
        } catch (err) {
          if (!(err instanceof PosInvalidPhoneError)) throw err;
        }
      } else if (input.linkOrderId) {
        const { rows } = await client.query<{ member_id: string | null }>(
          `SELECT member_id FROM pos_orders WHERE id = $2 AND user_id = $1`,
          [userId, input.linkOrderId],
        );
        campaignMemberId = rows[0]?.member_id ?? null;
      }

      const engineLines: EngineLine[] = computedLines.map((l, index) => ({
        index,
        productId: l.product.id,
        lineTotalCents: toCents(l.lineTotal),
        // MVP: ไม่ลดซ้อนบนบรรทัดที่มีส่วนลดแล้ว (คอมโบ) — ดู audit
        alreadyDiscounted: l.discountSource !== null,
      }));

      const { campaign, evaluation } = await validateCampaignForCart({
        userId,
        campaignId: input.campaignId,
        couponCode: input.couponCode,
        lines: engineLines,
        memberId: campaignMemberId,
        client,
      });
      if (!evaluation.valid) throw new PosCampaignRejectedError(evaluation.reason);

      const subtotalBefore = sumDecimals(...computedLines.map((l) => l.lineTotal));
      for (const [index, discCents] of evaluation.perLineDiscountCents) {
        if (discCents <= 0) continue;
        const line = computedLines[index];
        const newCents = toCents(line.lineTotal) - discCents;
        // ราคาป้าย = ราคาก่อนลด (ต่อหน่วย) · line_total คือค่าจริงที่ SUM ต้องตรง
        line.listUnitPrice = line.listUnitPrice ?? line.unitSellPrice;
        line.lineTotal = centsToDecimalString(newCents);
        line.unitSellPrice = centsToDecimalString(Math.floor(newCents / line.qty));
        line.discountSource = "coupon";
      }
      campaignApplied = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        couponCode: campaign.code,
        discountAmount: evaluation.discountAmount,
        subtotalBefore,
        usageLimitPerCustomer: campaign.usageLimitPerCustomer,
        memberId: campaignMemberId,
      };
    }

    /**
     * ═══ Partner Benefit (0086) ═══════════════════════════════════
     *
     * วางต่อจากแคมเปญด้วยเหตุผลเดียวกัน: หลังคอมโบกาง ก่อน surcharge
     *   · ค่าส่งไม่ถูกลด
     *   · ส่วนลดฝังในราคาบรรทัด → invariant Σ line_total = total เดิมยังจริง
     *   · ไม่มี journal เพิ่ม (เป็นรายได้ที่ลดลง ไม่ใช่เงินจ่ายออก)
     *
     * client ส่งได้แค่ partnerId — ต้นทุน/ส่วนลด/กำไร คิดจาก DB สดทั้งหมด
     */
    let partnerApplied: PartnerApplied | null = null;

    if (input.partnerId) {
      const engineLines: PartnerEngineLine[] = computedLines.map((l, index) => ({
        index,
        lineTotalCents: toCents(l.lineTotal),
        lineCostCents: toCents(l.lineCost),
        qty: l.qty,
        alreadyDiscounted: l.discountSource !== null,
      }));

      partnerApplied = await applyPartnerBenefit({
        client,
        userId,
        partnerId: input.partnerId,
        lines: engineLines,
        // แคมเปญ/คูปองถูกใช้ไปแล้วในบิลนี้ = ห้ามซ้อนสิทธิ์หุ้นส่วน
        hasOtherBillDiscount: campaignApplied !== null,
      });

      for (const [index, discCents] of partnerApplied.perLineDiscountCents) {
        if (discCents <= 0) continue;
        const line = computedLines[index];
        const newCents = toCents(line.lineTotal) - discCents;
        line.listUnitPrice = line.listUnitPrice ?? line.unitSellPrice;
        line.lineTotal = centsToDecimalString(newCents);
        line.unitSellPrice = centsToDecimalString(Math.floor(newCents / line.qty));
        line.discountSource = "partner";
      }
    }

    /**
     * ═══ Gift Voucher (0094) ═══════════════════════════════════════
     *
     * ลำดับเดียวกับ campaign/partner: หลังคอมโบ ก่อน surcharge → ค่าส่งไม่ถูกลด
     * ส่วนลดฝังบรรทัด discount_source='voucher' → invariant Σ line_total = total ยังจริง
     * Voucher = Revenue Reduction (decision D-3 A) — ไม่แตะ payments / journal
     *
     * client ส่งแค่ voucherToken (จาก QR) — มูลค่า/สถานะอ่านจาก DB ใน transaction นี้
     * FOR UPDATE ล็อกใบไว้จนกว่าจะ COMMIT → POS สองเครื่องใช้ใบเดียวกันพร้อมกันไม่ได้
     * D-5 A: 1 บิล 1 voucher · ห้ามซ้อน coupon/partner
     */
    let voucherApplied: {
      /** ใบที่ตรวจแล้ว (secure = มี id · manual (V2.1) = range + code · redeem ผ่านจุดเดียว) */
      voucher: ValidatedVoucher;
      publicCode: string;
      campaignName: string;
      discountAmount: string;
      subtotalBefore: string;
    } | null = null;

    if (input.voucherToken) {
      if (campaignApplied || partnerApplied) {
        throw new PosVoucherRejectedError("STACKED_DISCOUNT");
      }
      const engineLines: EngineLine[] = computedLines.map((l, index) => ({
        index,
        productId: l.product.id,
        lineTotalCents: toCents(l.lineTotal),
        alreadyDiscounted: l.discountSource !== null,
      }));
      const { voucher, evaluation } = await validateVoucherForCart({
        userId,
        scan: input.voucherToken,
        lines: engineLines,
        client,
      });
      // statusOnly ไม่เคยถูกส่งจากที่นี่ — evaluation ต้องมีเสมอ (type guard ป้องกันการเรียกผิดในอนาคต)
      if (!evaluation) throw new PosVoucherRejectedError("NO_ELIGIBLE_ITEMS");
      const subtotalBefore = sumDecimals(...computedLines.map((l) => l.lineTotal));
      for (const [index, discCents] of evaluation.perLineDiscountCents) {
        if (discCents <= 0) continue;
        const line = computedLines[index];
        const newCents = toCents(line.lineTotal) - discCents;
        line.listUnitPrice = line.listUnitPrice ?? line.unitSellPrice;
        line.lineTotal = centsToDecimalString(newCents);
        line.unitSellPrice = centsToDecimalString(Math.floor(newCents / line.qty));
        line.discountSource = "voucher";
      }
      voucherApplied = {
        voucher,
        publicCode: voucher.publicCode,
        campaignName: voucher.campaignName,
        discountAmount: evaluation.discountAmount,
        subtotalBefore,
      };
    }

    // ค่าบริการเพิ่ม (เช่น ค่าส่งเดลิเวอรี่) — เก็บเป็นบรรทัดในบิลที่ไม่มี product_id
    // เพื่อให้ SUM(bill_items.line_total) = total_amount = journal เสมอ
    const surchargeLines = (input.surcharges ?? [])
      .map((sc, i) => ({
        label: sc.label,
        lineTotal: centsToDecimalString(toCents(sc.amount)),
        sortOrder: computedLines.length + i,
      }))
      .filter((sc) => toCents(sc.lineTotal) > 0);

    const totalAmount = sumDecimals(
      ...computedLines.map((l) => l.lineTotal),
      ...surchargeLines.map((sc) => sc.lineTotal),
    );

    // Normalize payments: explicit split list, or legacy single method = full total.
    // Server re-validates the sum — client amounts are never trusted blindly.
    const payments: { method: PosPaymentMethod; amount: string }[] = input.payments?.length
      ? input.payments.map((p) => ({
          method: p.method,
          amount: centsToDecimalString(toCents(p.amount)),
        }))
      : [{ method: input.paymentMethod ?? "cash", amount: totalAmount }];

    const paymentsSumCents = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
    if (paymentsSumCents !== toCents(totalAmount)) {
      throw new PosPaymentMismatchError();
    }

    const billMethod = payments.length === 1 ? payments[0].method : "split";

    const { rows: billRows } = await client.query<BillRow>(
      // snapshot หุ้นส่วนอยู่ใน INSERT เดียวกับบิล — อยู่ใน transaction เดียวกับ
      // การชำระเงิน ต้นทุน/ชื่อ/ตั้งค่าที่เปลี่ยนทีหลังจึงไม่กระทบประวัติ
      `INSERT INTO pos_bills
         (user_id, bill_no, status, total_amount, payment_method, entry_date,
          partner_id, partner_name, partner_regular_total, partner_paid_total,
          partner_discount_amount, partner_cost_total, partner_contribution, voucher_id)
       VALUES ($1, $2, 'paid', $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, user_id, bill_no, status, total_amount::text, payment_method,
         entry_date::text, income_entry_id, created_at`,
      [
        userId, billNo, totalAmount, billMethod, entryDate,
        partnerApplied?.partnerId ?? null,
        partnerApplied?.partnerName ?? null,
        partnerApplied?.regularTotal ?? null,
        partnerApplied?.paidTotal ?? null,
        partnerApplied?.discountAmount ?? null,
        partnerApplied?.costTotal ?? null,
        partnerApplied?.contribution ?? null,
        // manual code ไม่มีแถวใบ → NULL (ประวัติอยู่ที่ redemptions.manual_code)
        voucherApplied?.voucher.id ?? null,
      ],
    );
    const bill = billRows[0];

    const insertedItems: PosBillItem[] = [];

    for (const {
      product, qty, note, unitSellPrice, lineTotal, lineCost, sortOrder, selectedModifiers,
      listUnitPrice, discountSource, comboId, comboName,
    } of computedLines) {
      const { rows: itemRows } = await client.query<BillItemRow>(
        `INSERT INTO pos_bill_items
           (bill_id, product_id, product_name, unit_sell_price, unit_cost_price,
            quantity, line_total, line_cost, sort_order, note,
            list_unit_price, discount_source, combo_id, combo_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, bill_id, product_id, product_name,
           unit_sell_price::text, unit_cost_price::text, quantity::text,
           line_total::text, line_cost::text, sort_order, note`,
        [
          bill.id,
          product.id,
          product.name,
          unitSellPrice,
          product.cost_price,
          qty,
          lineTotal,
          lineCost,
          sortOrder,
          note,
          listUnitPrice,
          discountSource,
          comboId,
          comboName,
        ],
      );
      const insertedItem = mapBillItem(itemRows[0]);

      // Snapshot selected modifiers (name + delta as-of sale) onto the line.
      for (let i = 0; i < selectedModifiers.length; i++) {
        const m = selectedModifiers[i];
        await client.query(
          `INSERT INTO pos_bill_item_modifiers
             (bill_item_id, modifier_id, modifier_name, price_delta, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [insertedItem.id, m.id, m.name, m.priceDelta, i],
        );
      }
      if (selectedModifiers.length > 0) {
        insertedItem.modifiers = selectedModifiers.map((m) => ({
          modifierName: m.name,
          priceDelta: m.priceDelta,
        }));
      }
      insertedItems.push(insertedItem);

      if (product.track_stock) {
        const qtyChange = -qty;

        await client.query(
          `INSERT INTO pos_stock_movements
             (user_id, product_id, bill_id, movement_type, qty_change)
           VALUES ($1, $2, $3, 'sale', $4)`,
          [userId, product.id, bill.id, qtyChange],
        );

        const { rows: stockRows } = await client.query<{ stock_qty: string }>(
          `UPDATE pos_products
           SET stock_qty = stock_qty + $3, updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING stock_qty::text`,
          [product.id, userId, qtyChange],
        );

        const newQty = stockRows[0]?.stock_qty;
        if (newQty != null && toCents(newQty) < 0) {
          negativeStockProductIds.push(product.id);
        }
      }
    }

    for (const sc of surchargeLines) {
      const { rows: scRows } = await client.query<BillItemRow>(
        `INSERT INTO pos_bill_items
           (bill_id, product_id, product_name, unit_sell_price, unit_cost_price,
            quantity, line_total, line_cost, sort_order, note)
         VALUES ($1, NULL, $2, $3, 0, 1, $3, 0, $4, NULL)
         RETURNING id, bill_id, product_id, product_name,
           unit_sell_price::text, unit_cost_price::text, quantity::text,
           line_total::text, line_cost::text, sort_order, note`,
        [bill.id, sc.label, sc.lineTotal, sc.sortOrder],
      );
      insertedItems.push(mapBillItem(scRows[0]));
    }

    // ตัดวัตถุดิบตามสูตร (สินค้า + modifier ที่เลือก) — ใน transaction เดียวกับบิล
    await deductIngredientsForBill(
      client,
      userId,
      bill.id,
      computedLines.map((l) => ({
        productId: l.product.id,
        qty: l.qty,
        modifierIds: l.selectedModifiers.map((m) => m.id),
      })),
    );

    // Income entries per bucket: cash → 'cash', promptpay/thai_chuay_thai → 'transfer'.
    // Split bills produce up to 2 entries so เงินสด/เงินโอน on-hand stay correct.
    let cashCents = 0;
    let transferCents = 0;
    for (const p of payments) {
      if (POS_TO_INCOME_PAYMENT_METHOD[p.method] === "cash") cashCents += toCents(p.amount);
      else transferCents += toCents(p.amount);
    }

    const incomeEntryByBucket: Partial<Record<"cash" | "transfer", string>> = {};
    for (const bucket of ["cash", "transfer"] as const) {
      const cents = bucket === "cash" ? cashCents : transferCents;
      if (cents <= 0) continue;
      const { rows: incomeRows } = await client.query<{ id: string }>(
        `INSERT INTO income_entries (user_id, amount, category, payment_method, note, entry_date)
         VALUES ($1, $2, 'storefront', $3, $4, $5::date)
         RETURNING id`,
        [userId, centsToDecimalString(cents), bucket, `POS ${billNo}`, entryDate],
      );
      incomeEntryByBucket[bucket] = incomeRows[0].id;
    }

    const primaryIncomeEntryId =
      incomeEntryByBucket.cash ?? incomeEntryByBucket.transfer ?? null;

    const insertedPayments = [];
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      // บิล ฿0 (voucher ครอบทั้งบิล, 0094) — ไม่มีเงินเปลี่ยนมือ จึงไม่มีแถวชำระเงิน
      // เหมือน income_entries ที่ข้ามยอด 0 อยู่แล้ว · CHECK amount > 0 ของ 0051 ยังคงเดิม
      if (toCents(p.amount) <= 0) continue;
      const bucket = POS_TO_INCOME_PAYMENT_METHOD[p.method];
      const { rows: payRows } = await client.query<{
        id: string;
        bill_id: string;
        method: PosPaymentMethod;
        amount: string;
        income_entry_id: string | null;
        sort_order: number;
      }>(
        `INSERT INTO pos_bill_payments (bill_id, method, amount, income_entry_id, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, bill_id, method, amount::text, income_entry_id, sort_order`,
        [bill.id, p.method, p.amount, incomeEntryByBucket[bucket] ?? null, i],
      );
      insertedPayments.push({
        id: payRows[0].id,
        billId: payRows[0].bill_id,
        method: payRows[0].method,
        amount: payRows[0].amount,
        incomeEntryId: payRows[0].income_entry_id,
        sortOrder: payRows[0].sort_order,
      });
    }

    const { rows: linkedBillRows } = await client.query<BillRow>(
      `UPDATE pos_bills
       SET income_entry_id = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, bill_no, status, total_amount::text, payment_method,
         entry_date::text, income_entry_id, created_at`,
      [bill.id, userId, primaryIncomeEntryId],
    );

    const mappedBill = mapBill(linkedBillRows[0]);

    await postPosBillJournal(client, mappedBill, insertedItems, payments);

    /**
     * รู B — ผูกบิลกลับเข้าออเดอร์ "ใน transaction เดียวกัน"
     *
     * ⚠️ เกิดขึ้นจริง 29 ก.ค. 69: closePosBill (transaction ของตัวเอง) สำเร็จ
     * แต่ updatePosOrderStatus({billId}) ที่เรียกแยกกันภายหลังล้ม → ได้บิลที่ไม่มี
     * ออเดอร์ผูก 3 ใบ (Q260729-034/035/036) เสี่ยงเก็บเงินซ้ำ
     *
     * ตอนนี้ผูกในนี้เลย: ถ้าผูกไม่ได้ทั้งบิลจะ ROLLBACK ไม่มีสภาพครึ่งทาง
     * ไม่แตะ status — ให้ฝั่งเรียกจัดการแยก (เก็บเงินก่อนทำยังต้องทำอาหารต่อ)
     */
    if (input.linkOrderId) {
      const { rowCount } = await client.query(
        `UPDATE pos_orders
         SET bill_id = $3, updated_at = now()
         WHERE id = $2 AND user_id = $1 AND bill_id IS NULL
           AND status NOT IN ('cancelled')`,
        [userId, input.linkOrderId, mappedBill.id],
      );
      if (!rowCount) throw new PosOrderLinkFailedError();
    }

    // Campaign usage — transaction เดียวกับบิล: บิลล้ม usage หาย, usage ล้ม บิลไม่เกิด
    // atomic UPDATE ข้างในคือคนบังคับ usage limit จริง (pre-check ของ engine แพ้ race ได้)
    if (campaignApplied) {
      await recordCampaignUsage(client, userId, {
        campaignId: campaignApplied.campaignId,
        billId: mappedBill.id,
        billNo: mappedBill.billNo,
        memberId: campaignApplied.memberId,
        couponCode: campaignApplied.couponCode,
        discountAmount: campaignApplied.discountAmount,
        orderSubtotal: campaignApplied.subtotalBefore,
        orderTotal: mappedBill.totalAmount,
        usageLimitPerCustomer: campaignApplied.usageLimitPerCustomer,
      });
    }

    // Voucher redeem — atomic UPDATE + UNIQUE redemption ใน transaction เดียวกับบิล
    // ใบยังล็อกอยู่จาก FOR UPDATE ข้างบน → ไม่มีใครแทรกได้ระหว่างตรวจกับใช้
    if (voucherApplied) {
      await redeemAppliedVoucherInTx(client, userId, {
        voucher: voucherApplied.voucher,
        billId: mappedBill.id,
        billNo: mappedBill.billNo,
        // บิลปิดใต้ session เจ้าของ (POS ไม่ส่งตัวตนพนักงานมากับบิล — ช่องว่างเดิม, Known Limitation)
        employeeId: null,
        orderSubtotal: voucherApplied.subtotalBefore,
        voucherAmount: voucherApplied.discountAmount,
        // final = subtotal − voucher (ไม่รวม surcharge — CHECK ใน DB บังคับสมการนี้)
        finalTotal: centsToDecimalString(
          toCents(voucherApplied.subtotalBefore) - toCents(voucherApplied.discountAmount),
        ),
      });
    }

    /**
     * สมาชิก + แต้ม (0068) — ใน transaction เดียวกับบิล
     *
     * ⚠️ แต้มไม่ใช่เงิน: แตะแค่ pos_members / pos_point_events / pos_bills.member_id
     * ไม่มี income_entries ไม่มี journal ไม่แตะ total_amount
     * → invariant Σ line_total = total_amount = debit = credit ยังจริงทุกตัวอักษร
     *
     * ที่มาของเบอร์: พนักงานกรอกตอนเก็บเงิน (memberPhone) หรือ
     * ลูกค้าติ๊กสะสมแต้มตอนสั่ง QR (pos_orders.member_id ผูกไว้แล้ว)
     */
    let pointsEarned = 0;
    let memberPoints: number | undefined;
    try {
      let memberId: string | null = campaignApplied?.memberId ?? null;
      if (!memberId && input.memberPhone) {
        const member = await upsertPosMember(
          userId,
          { phone: input.memberPhone, name: input.memberName ?? null },
          client,
        );
        memberId = member.id;
      } else if (input.linkOrderId) {
        const { rows } = await client.query<{ member_id: string | null }>(
          `SELECT member_id FROM pos_orders WHERE id = $2 AND user_id = $1`,
          [userId, input.linkOrderId],
        );
        memberId = rows[0]?.member_id ?? null;
      }
      if (memberId) {
        pointsEarned = await earnPointsForBill(client, userId, {
          memberId,
          billId: mappedBill.id,
          totalAmount: mappedBill.totalAmount,
        });
        const { rows } = await client.query<{ points: number }>(
          `SELECT points FROM pos_members WHERE id = $2 AND user_id = $1`,
          [userId, memberId],
        );
        memberPoints = rows[0]?.points;
      }
    } catch (err) {
      // เบอร์ผิดรูปแบบไม่ควรทำให้ "เก็บเงินไม่สำเร็จ" — แต้มเป็นของแถม เงินคือของจริง
      if (err instanceof PosInvalidPhoneError) {
        pointsEarned = 0;
      } else {
        throw err;
      }
    }

    await client.query("COMMIT");

    return {
      bill: mappedBill,
      items: insertedItems,
      payments: insertedPayments,
      negativeStockProductIds,
      pointsEarned,
      memberPoints,
      campaign: campaignApplied
        ? {
            name: campaignApplied.campaignName,
            discountAmount: campaignApplied.discountAmount,
            subtotalBefore: campaignApplied.subtotalBefore,
          }
        : undefined,
      voucher: voucherApplied
        ? {
            publicCode: voucherApplied.publicCode,
            campaignName: voucherApplied.campaignName,
            discountAmount: voucherApplied.discountAmount,
            subtotalBefore: voucherApplied.subtotalBefore,
          }
        : undefined,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
