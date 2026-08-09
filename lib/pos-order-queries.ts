import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getDayCutoffHour } from "@/lib/pos-settings-queries";
import { businessDate } from "@/lib/date";
import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";
import { resolveCartModifiers, type SelectedModifier } from "@/lib/pos-modifier-queries";
import { pushOrderStatus } from "@/lib/pos-push-queries";
import { PosInvalidPhoneError, upsertPosMember } from "@/lib/pos-member-queries";
import { expandComboToLines } from "@/lib/pos-combo-queries";

/**
 * QR pre-orders — reservations only. No stock/income/journal here; staff
 * converts to a bill (closeBill) at pickup and links bill_id.
 */

export type PosOrderStatus =
  | "pending"
  | "accepted"
  | "cooking"
  | "ready"
  | "completed"
  | "cancelled";

/** qr = ลูกค้าสั่งเอง (จ่ายตอนรับ) · pos = ตั๋วครัวจากบิล walk-in ที่จ่ายแล้ว */
export type PosOrderChannel = "qr" | "pos";

export type PosOrderItemModifier = { modifierName: string; priceDelta: string };

export type PosOrderItem = {
  id: string;
  productId: string | null;
  productName: string;
  unitSellPrice: string;
  quantity: string;
  lineTotal: string;
  sortOrder: number;
  /** โน้ตต่อรายการ เช่น "ไม่ใส่ผัก" */
  note: string | null;
  /** บรรทัดนี้มาจากคอมโบใบไหน (0071) — ครัวต้องรู้ว่าเป็นชุด ไม่ใช่ของแยก */
  comboId?: string | null;
  comboName?: string | null;
  modifiers?: PosOrderItemModifier[];
  /** ids needed by staff to convert to a bill via closeBill */
  modifierIds?: string[];
};

export type PosOrder = {
  id: string;
  orderNo: string;
  status: PosOrderStatus;
  channel: PosOrderChannel;
  customerName: string;
  customerPhone: string | null;
  note: string | null;
  pickupAtText: string | null;
  totalAmount: string;
  billId: string | null;
  cancelReason: string | null;
  createdAt: string;
  /** at_shop = จ่ายที่ร้าน · prepaid_transfer = ลูกค้าโอนมาก่อน */
  paymentIntent: "at_shop" | "prepaid_transfer";
  slipUrl: string | null;
  slipUploadedAt: string | null;
  slipVerifiedAt: string | null;
  slipRejectedReason: string | null;
  /** pickup = มารับที่ร้าน · delivery = ส่งถึงบ้าน */
  orderType: "pickup" | "delivery";
  deliveryAddress: string | null;
  deliveryNote: string | null;
  /** พิกัดที่ลูกค้าแชร์มา (ถ้ามี) — ใช้นำทางแทนที่อยู่ตัวอักษร */
  deliveryLat: string | null;
  deliveryLng: string | null;
  deliveryAccuracyM: string | null;
  /** ค่าส่ง (รวมอยู่ใน totalAmount แล้ว) */
  deliveryFee: string;
  /** คนส่ง — ใครกด "รับงาน" ไปแล้ว (null = ยังไม่มีใครรับ) */
  riderId: string | null;
  riderName: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  /** เงินสดปลายทางถูกเอามาคืนหน้าร้านแล้วเมื่อไหร่ (reconciliation เท่านั้น) */
  cashSettledAt: string | null;
  /** before = เก็บเงินก่อนเริ่มทำ · after = เก็บตอนลูกค้ามารับ */
  paymentTiming: "before" | "after";
  /** จำนวนข้อความจากลูกค้าในแชท (เฉพาะ listPosOrders — ใช้ทำ badge/เสียงเตือน) */
  customerMsgCount?: number;
  items: PosOrderItem[];
};

export type PublicOrderResult = {
  orderNo: string;
  accessToken: string;
  totalAmount: string;
};

export class PosDeliveryUnavailableError extends Error {
  constructor() {
    super("delivery not available");
    this.name = "PosDeliveryUnavailableError";
  }
}

export class PosDeliveryMinOrderError extends Error {
  constructor(public minOrder: string) {
    super("order below delivery minimum");
    this.name = "PosDeliveryMinOrderError";
  }
}

export class PosOrderProductError extends Error {
  constructor() {
    super("order product invalid");
    this.name = "PosOrderProductError";
  }
}

export class PosOrderNotFoundError extends Error {
  constructor() {
    super("order not found");
    this.name = "PosOrderNotFoundError";
  }
}

export class PosOrderTransitionError extends Error {
  constructor() {
    super("invalid order status transition");
    this.name = "PosOrderTransitionError";
  }
}

/**
 * ยกเลิกออเดอร์ที่เก็บเงินไปแล้วไม่ได้ — ต้องยกเลิกบิลก่อน
 *
 * ⚠️ ทำไมต้องกัน: ถ้าปล่อยให้ยกเลิกได้ รายได้จะค้างในงบโดยไม่มีอาหารส่งมอบ
 * (สต็อกก็ถูกตัดไปแล้ว) การยกเลิกบิลมี audit trail + คืนสต็อกให้ครบ
 * เดิมไม่เป็นปัญหาเพราะบิลเกิดตอน ready เป็นขั้นสุดท้าย — แต่พอมี "เก็บเงินก่อนทำ"
 * ลำดับกลายเป็น จ่าย → เปลี่ยนใจ → ยกเลิก จึงต้องบังคับให้ยกเลิกบิลก่อน
 */
export class PosOrderHasBillError extends Error {
  constructor(public billId: string) {
    super("cannot cancel a paid order — void the bill first");
    this.name = "PosOrderHasBillError";
  }
}

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  channel: string;
  customer_name: string;
  customer_phone: string | null;
  note: string | null;
  pickup_at_text: string | null;
  total_amount: string;
  bill_id: string | null;
  cancel_reason: string | null;
  created_at: Date | string;
  payment_intent: string;
  slip_url: string | null;
  slip_uploaded_at: Date | string | null;
  slip_verified_at: Date | string | null;
  slip_rejected_reason: string | null;
  order_type: string;
  delivery_address: string | null;
  delivery_note: string | null;
  delivery_lat: string | null;
  delivery_lng: string | null;
  delivery_accuracy_m: string | null;
  delivery_fee: string;
  rider_id: string | null;
  picked_up_at: Date | string | null;
  delivered_at: Date | string | null;
  cash_settled_at: Date | string | null;
  payment_timing: string;
};

const ORDER_RETURN = `id, order_no, status, channel, customer_name, customer_phone, note,
  pickup_at_text, total_amount::text AS total_amount, bill_id, cancel_reason, created_at,
  payment_intent, slip_url, slip_uploaded_at, slip_verified_at, slip_rejected_reason,
  order_type, delivery_address, delivery_note,
  delivery_lat::text AS delivery_lat, delivery_lng::text AS delivery_lng,
  delivery_accuracy_m::text AS delivery_accuracy_m,
  delivery_fee::text AS delivery_fee,
  rider_id, picked_up_at, delivered_at, cash_settled_at, payment_timing`;

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toIsoOrNull(v: Date | string | null): string | null {
  return v == null ? null : toIso(v);
}

function mapOrder(r: OrderRow, items: PosOrderItem[]): PosOrder {
  return {
    id: r.id,
    orderNo: r.order_no,
    status: r.status as PosOrderStatus,
    channel: (r.channel as PosOrderChannel) ?? "qr",
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    note: r.note,
    pickupAtText: r.pickup_at_text,
    totalAmount: r.total_amount,
    billId: r.bill_id,
    cancelReason: r.cancel_reason,
    createdAt: toIso(r.created_at),
    paymentIntent: (r.payment_intent as PosOrder["paymentIntent"]) ?? "at_shop",
    slipUrl: r.slip_url,
    slipUploadedAt: toIsoOrNull(r.slip_uploaded_at),
    slipVerifiedAt: toIsoOrNull(r.slip_verified_at),
    slipRejectedReason: r.slip_rejected_reason,
    orderType: (r.order_type as PosOrder["orderType"]) ?? "pickup",
    deliveryAddress: r.delivery_address,
    deliveryNote: r.delivery_note,
    deliveryLat: r.delivery_lat,
    deliveryLng: r.delivery_lng,
    deliveryAccuracyM: r.delivery_accuracy_m,
    deliveryFee: r.delivery_fee ?? "0.00",
    riderId: r.rider_id ?? null,
    riderName: null,
    pickedUpAt: toIsoOrNull(r.picked_up_at ?? null),
    deliveredAt: toIsoOrNull(r.delivered_at ?? null),
    cashSettledAt: toIsoOrNull(r.cash_settled_at ?? null),
    paymentTiming: (r.payment_timing as PosOrder["paymentTiming"]) ?? "after",
    items,
  };
}

/** เติมชื่อคนส่งลงในออเดอร์ที่มี rider_id (query แยกเพื่อไม่ให้ ORDER_RETURN ต้อง join) */
async function attachRiderNames(orders: PosOrder[]): Promise<PosOrder[]> {
  const ids = [...new Set(orders.map((o) => o.riderId).filter((v): v is string => !!v))];
  if (ids.length === 0) return orders;
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM pos_riders WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  for (const o of orders) {
    if (o.riderId) o.riderName = byId.get(o.riderId) ?? null;
  }
  return orders;
}

export type PublicShopInfo = {
  userId: string;
  shopName: string;
  onlineOrderingEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFee: string;
  deliveryMinOrder: string;
  deliveryAreaNote: string | null;
};

export async function getShopByMenuToken(token: string): Promise<PublicShopInfo | null> {
  const { rows } = await pool.query<{
    user_id: string;
    shop_name: string;
    online_ordering_enabled: boolean;
    delivery_enabled: boolean;
    delivery_fee: string;
    delivery_min_order: string;
    delivery_area_note: string | null;
  }>(
    `SELECT s.user_id, u.shop_name, s.online_ordering_enabled,
            s.delivery_enabled, s.delivery_fee::text AS delivery_fee,
            s.delivery_min_order::text AS delivery_min_order, s.delivery_area_note
     FROM pos_shop_settings s
     JOIN users u ON u.id = s.user_id
     WHERE s.public_menu_token = $1`,
    [token],
  );
  if (!rows[0]) return null;
  return {
    userId: rows[0].user_id,
    shopName: rows[0].shop_name,
    onlineOrderingEnabled: rows[0].online_ordering_enabled,
    deliveryEnabled: rows[0].delivery_enabled,
    deliveryFee: rows[0].delivery_fee,
    deliveryMinOrder: rows[0].delivery_min_order,
    deliveryAreaNote: rows[0].delivery_area_note,
  };
}

/**
 * เลขคิวถัดไป "Q<yymmdd>-NNN" — self-healing
 *
 * ⚠️ บทเรียนจริง (29 ก.ค. 69): counter หลุดไปต่ำกว่าเลขที่ใช้แล้ว (6 vs 69) เพราะ
 * มีการลบ/รีเซ็ต pos_order_counters ทิ้งโดยที่ pos_orders ยังอยู่ → INSERT ชน
 * UNIQUE (user_id, order_no) ทุกครั้ง → 500 → ร้านขายไม่ได้เลยทั้งวัน
 *
 * กันไว้ด้วยการยกพื้นเป็น MAX(เลขที่ใช้จริงวันนี้) ก่อนบวกหนึ่งเสมอ
 * ต้นทุน: subquery หนึ่งครั้งต่อออเดอร์ ใช้ index UNIQUE (user_id, order_no) → ถูกมาก
 * และ UPDATE ล็อกแถว counter อยู่แล้ว จึงยังกันสั่งพร้อมกันได้เหมือนเดิม
 */
async function nextOrderNo(client: PoolClient, userId: string): Promise<string> {
  // ใช้ "วันขาย" ไม่ใช่วันปฏิทิน — ไม่งั้นเลขคิวรีเซ็ตกลางกะตอนเที่ยงคืน
  // (ร้านที่ขายถึง 02:00 จะมี Q...-001 ซ้ำสองรอบในกะเดียว สับสนตอนเรียกคิว)
  const counterDate = businessDate(await getDayCutoffHour(userId, client));
  const prefix = `Q${counterDate.replace(/-/g, "").slice(2)}`;

  await client.query(
    `INSERT INTO pos_order_counters (user_id, counter_date, last_seq)
     VALUES ($1, $2::date, 0)
     ON CONFLICT (user_id, counter_date) DO NOTHING`,
    [userId, counterDate],
  );

  const { rows } = await client.query<{ last_seq: number }>(
    `UPDATE pos_order_counters c
     SET last_seq = GREATEST(
           c.last_seq,
           COALESCE((
             SELECT MAX(split_part(o.order_no, '-', 2)::int)
             FROM pos_orders o
             WHERE o.user_id = $1
               AND o.order_no LIKE $3 || '-%'
               -- กัน cast พังถ้ามีเลขรูปแบบอื่นหลงเข้ามา
               AND o.order_no ~ '^Q[0-9]{6}-[0-9]+$'
           ), 0)
         ) + 1
     WHERE c.user_id = $1 AND c.counter_date = $2::date
     RETURNING c.last_seq`,
    [userId, counterDate, prefix],
  );
  if (!rows[0]) throw new Error("order counter row missing after upsert");

  return `${prefix}-${String(rows[0].last_seq).padStart(3, "0")}`;
}

export type CreatePublicOrderInput = {
  customerName?: string;
  customerPhone?: string;
  note?: string;
  pickupAtText?: string;
  /** ลูกค้าเลือกจะโอนก่อนหรือจ่ายที่ร้าน */
  paymentIntent?: "at_shop" | "prepaid_transfer";
  /** pickup = มารับเอง · delivery = ให้ไปส่ง (ต้องมีที่อยู่) */
  orderType?: "pickup" | "delivery";
  deliveryAddress?: string;
  deliveryNote?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryAccuracyM?: number;
  items: { productId: string; qty: number; modifierIds?: string[]; note?: string }[];
  /** คอมโบ (0071) — ราคาและรายการอ่านจาก DB ฝั่งเซิร์ฟเวอร์ */
  combos?: { comboId: string; qty: number }[];
};

/** Create a pre-order — prices resolved server-side, snapshot into order rows. */
export async function createPublicOrder(
  userId: string,
  input: CreatePublicOrderInput,
): Promise<PublicOrderResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /**
     * คอมโบ → บรรทัดสินค้าจริง (0071) — ตรรกะเดียวกับตอนปิดบิลเป๊ะ
     * ต้องกางที่นี่ด้วย ไม่งั้นออเดอร์ QR สั่งคอมโบไม่ได้ (ซึ่งเป็นทางหลักของลูกค้า)
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

    const productIds = [
      ...new Set([
        ...input.items.map((i) => i.productId),
        ...comboExpanded.map((c) => c.productId),
      ]),
    ];
    const { rows: productRows } = await client.query<{
      id: string;
      name: string;
      sell_price: string;
    }>(
      `SELECT id, name, sell_price::text FROM pos_products
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
      [userId, productIds],
    );
    const products = new Map(productRows.map((r) => [r.id, r]));
    if (products.size !== productIds.length) throw new PosOrderProductError();

    const modifiersByLine = await resolveCartModifiers(client, userId, input.items);

    type ComputedOrderLine = {
      product: { id: string; name: string; sell_price: string };
      qty: number;
      note: string | null;
      selected: SelectedModifier[];
      unitSellPrice: string;
      lineTotal: string;
      sortOrder: number;
      listUnitPrice: string | null;
      comboId: string | null;
      comboName: string | null;
    };

    const computed: ComputedOrderLine[] = input.items.map((line, sortOrder) => {
      const product = products.get(line.productId)!;
      const selected: SelectedModifier[] = modifiersByLine.get(sortOrder) ?? [];
      const unitCents =
        toCents(product.sell_price) + selected.reduce((s, m) => s + toCents(m.priceDelta), 0);
      const lineCents = Math.round((unitCents * Math.round(line.qty * 1000)) / 1000);
      return {
        product,
        qty: line.qty,
        note: line.note?.trim() || null,
        selected,
        unitSellPrice: centsToDecimalString(unitCents),
        lineTotal: centsToDecimalString(lineCents),
        sortOrder,
        listUnitPrice: null,
        comboId: null,
        comboName: null,
      };
    });

    comboExpanded.forEach((c, i) => {
      computed.push({
        product: products.get(c.productId)!,
        qty: c.qty,
        note: null,
        selected: [],
        unitSellPrice: c.unitSellPrice,
        lineTotal: c.lineTotal,
        sortOrder: input.items.length + i,
        listUnitPrice: c.listUnitPrice,
        comboId: c.comboId,
        comboName: c.comboName,
      });
    });

    if (computed.length === 0) throw new PosOrderProductError();

    const itemsTotal = sumDecimals(...computed.map((c) => c.lineTotal));

    // เดลิเวอรี่: อ่านค่าส่ง/ยอดขั้นต่ำจากตั้งค่าร้าน (ไม่เชื่อ client)
    let deliveryFee = "0.00";
    if (input.orderType === "delivery") {
      const { rows: cfg } = await client.query<{
        delivery_enabled: boolean;
        delivery_fee: string;
        delivery_min_order: string;
      }>(
        `SELECT delivery_enabled, delivery_fee::text AS delivery_fee,
                delivery_min_order::text AS delivery_min_order
         FROM pos_shop_settings WHERE user_id = $1`,
        [userId],
      );
      if (!cfg[0]?.delivery_enabled) throw new PosDeliveryUnavailableError();
      // ต้องรู้ว่าจะส่งที่ไหน: พิกัดที่แชร์มา หรือที่อยู่ตัวอักษร อย่างน้อยหนึ่งอย่าง
      const hasGeo = input.deliveryLat != null && input.deliveryLng != null;
      if (!hasGeo && !input.deliveryAddress?.trim()) {
        throw new PosDeliveryUnavailableError();
      }
      if (toCents(itemsTotal) < toCents(cfg[0].delivery_min_order)) {
        throw new PosDeliveryMinOrderError(cfg[0].delivery_min_order);
      }
      deliveryFee = centsToDecimalString(toCents(cfg[0].delivery_fee));
    }

    const totalAmount = sumDecimals(itemsTotal, deliveryFee);
    const orderNo = await nextOrderNo(client, userId);

    const { rows: orderRows } = await client.query<{ id: string; access_token: string }>(
      `INSERT INTO pos_orders
         (user_id, order_no, customer_name, customer_phone, note, pickup_at_text,
          total_amount, payment_intent, order_type, delivery_address, delivery_note,
          delivery_fee, delivery_lat, delivery_lng, delivery_accuracy_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, access_token`,
      [
        userId,
        orderNo,
        input.customerName?.trim() || "ลูกค้า QR",
        input.customerPhone ?? null,
        input.note ?? null,
        input.pickupAtText ?? null,
        totalAmount,
        input.paymentIntent ?? "at_shop",
        input.orderType ?? "pickup",
        input.deliveryAddress?.trim() || null,
        input.deliveryNote?.trim() || null,
        deliveryFee,
        input.deliveryLat ?? null,
        input.deliveryLng ?? null,
        input.deliveryAccuracyM ?? null,
      ],
    );
    const orderId = orderRows[0].id;

    /**
     * ผูกสมาชิกจากเบอร์ที่ลูกค้ากรอกตอนสั่ง QR (0068)
     *
     * ทำเฉพาะเมื่อร้านเปิดสะสมแต้ม — ลูกค้าที่กรอกเบอร์เพื่อให้ร้านโทรกลับ
     * ได้แต้มไปเลยโดยไม่ต้องกรอกอะไรเพิ่ม แต้มเข้าจริงตอนปิดบิล
     * (closePosBill อ่าน pos_orders.member_id ผ่าน linkOrderId)
     *
     * ⚠️ ไม่แตะยอดออเดอร์/บิล/บัญชี · เบอร์รูปแบบผิดก็เพียงไม่ผูก ออเดอร์ยังสร้างสำเร็จ
     */
    if (input.customerPhone) {
      const { rows: pointCfg } = await client.query<{ points_enabled: boolean }>(
        `SELECT points_enabled FROM pos_shop_settings WHERE user_id = $1`,
        [userId],
      );
      if (pointCfg[0]?.points_enabled) {
        try {
          const member = await upsertPosMember(
            userId,
            { phone: input.customerPhone, name: input.customerName?.trim() || null },
            client,
          );
          await client.query(
            `UPDATE pos_orders SET member_id = $3 WHERE id = $2 AND user_id = $1`,
            [userId, orderId, member.id],
          );
        } catch (err) {
          if (!(err instanceof PosInvalidPhoneError)) throw err;
        }
      }
    }

    for (const c of computed) {
      const { rows: itemRows } = await client.query<{ id: string }>(
        `INSERT INTO pos_order_items
           (order_id, product_id, product_name, unit_sell_price, quantity, line_total,
            sort_order, note, combo_id, combo_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          orderId,
          c.product.id,
          c.product.name,
          c.unitSellPrice,
          c.qty,
          c.lineTotal,
          c.sortOrder,
          c.note,
          c.comboId,
          c.comboName,
        ],
      );
      for (let i = 0; i < c.selected.length; i++) {
        const m = c.selected[i];
        await client.query(
          `INSERT INTO pos_order_item_modifiers
             (order_item_id, modifier_id, modifier_name, price_delta, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [itemRows[0].id, m.id, m.name, m.priceDelta, i],
        );
      }
    }

    await client.query("COMMIT");

    // เด้งมือถือร้าน — ออเดอร์ใหม่เข้า (fire-and-forget)
    void import("@/lib/pos-push-queries")
      .then((m) =>
        m.pushStaff(userId, {
          title: `🔔 ออเดอร์ใหม่ · ${orderNo}`,
          body: `${input.customerName?.trim() || "ลูกค้า QR"} · ฿${totalAmount}${input.orderType === "delivery" ? " · เดลิเวอรี่ 🛵" : ""}`,
          tag: `new-order-${orderRows[0].id}`,
        }),
      )
      .catch(() => {});

    return { orderNo, accessToken: orderRows[0].access_token, totalAmount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ออเดอร์จากพนักงานหน้าร้าน (ยังไม่จ่าย) — channel 'pos', เริ่มที่ 'accepted'
 * เพราะพนักงานรับออเดอร์เองแล้ว ไม่มี bill_id จนกว่าจะเก็บเงินตอนลูกค้ามารับ
 * ราคาคิดฝั่ง server เหมือน QR (client ส่งแค่ id)
 */
export async function createStaffOrder(
  userId: string,
  input: {
    items: { productId: string; qty: number; modifierIds?: string[]; note?: string }[];
    /** คอมโบ (0071) — ราคาอ่านจาก DB ฝั่งเซิร์ฟเวอร์ */
    combos?: { comboId: string; qty: number }[];
    customerName?: string;
    note?: string;
    /** ไม่ส่ง = ใช้ค่าเริ่มต้นของร้าน */
    paymentTiming?: "before" | "after";
  },
): Promise<PosOrder> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // คอมโบ → บรรทัดสินค้าจริง (0071) — ตรรกะเดียวกับ createPublicOrder และตอนปิดบิล
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

    const productIds = [
      ...new Set([
        ...input.items.map((i) => i.productId),
        ...comboExpanded.map((c) => c.productId),
      ]),
    ];
    const { rows: productRows } = await client.query<{
      id: string;
      name: string;
      sell_price: string;
    }>(
      `SELECT id, name, sell_price::text FROM pos_products
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
      [userId, productIds],
    );
    const products = new Map(productRows.map((r) => [r.id, r]));
    if (products.size !== productIds.length) throw new PosOrderProductError();

    const modifiersByLine = await resolveCartModifiers(client, userId, input.items);

    type StaffLine = {
      product: { id: string; name: string; sell_price: string };
      qty: number;
      note: string | null;
      selected: SelectedModifier[];
      unitSellPrice: string;
      lineTotal: string;
      sortOrder: number;
      comboId: string | null;
      comboName: string | null;
    };

    const computed: StaffLine[] = input.items.map((line, sortOrder) => {
      const product = products.get(line.productId)!;
      const selected: SelectedModifier[] = modifiersByLine.get(sortOrder) ?? [];
      const unitCents =
        toCents(product.sell_price) + selected.reduce((s, m) => s + toCents(m.priceDelta), 0);
      const lineCents = Math.round((unitCents * Math.round(line.qty * 1000)) / 1000);
      return {
        product,
        qty: line.qty,
        note: line.note?.trim() || null,
        selected,
        unitSellPrice: centsToDecimalString(unitCents),
        lineTotal: centsToDecimalString(lineCents),
        sortOrder,
        comboId: null,
        comboName: null,
      };
    });

    comboExpanded.forEach((c, i) => {
      computed.push({
        product: products.get(c.productId)!,
        qty: c.qty,
        note: null,
        selected: [],
        unitSellPrice: c.unitSellPrice,
        lineTotal: c.lineTotal,
        sortOrder: input.items.length + i,
        comboId: c.comboId,
        comboName: c.comboName,
      });
    });

    if (computed.length === 0) throw new PosOrderProductError();

    const totalAmount = sumDecimals(...computed.map((c) => c.lineTotal));
    const orderNo = await nextOrderNo(client, userId);

    // จังหวะเก็บเงิน: ใช้ที่ส่งมา ถ้าไม่ส่ง → ค่าเริ่มต้นของร้าน (ไม่เชื่อ client)
    let timing = input.paymentTiming ?? null;
    if (!timing) {
      const { rows: cfg } = await client.query<{ default_payment_timing: string }>(
        `SELECT default_payment_timing FROM pos_shop_settings WHERE user_id = $1`,
        [userId],
      );
      timing = cfg[0]?.default_payment_timing === "before" ? "before" : "after";
    }

    const { rows: orderRows } = await client.query<OrderRow>(
      `INSERT INTO pos_orders
         (user_id, order_no, status, channel, customer_name, note, total_amount,
          payment_timing)
       VALUES ($1, $2, 'accepted', 'pos', $3, $4, $5, $6)
       RETURNING ${ORDER_RETURN}`,
      [
        userId,
        orderNo,
        input.customerName?.trim() || "หน้าร้าน",
        input.note?.trim() || null,
        totalAmount,
        timing,
      ],
    );
    const orderId = orderRows[0].id;

    for (const c of computed) {
      const { rows: itemRows } = await client.query<{ id: string }>(
        `INSERT INTO pos_order_items
           (order_id, product_id, product_name, unit_sell_price, quantity, line_total,
            sort_order, note, combo_id, combo_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          orderId,
          c.product.id,
          c.product.name,
          c.unitSellPrice,
          c.qty,
          c.lineTotal,
          c.sortOrder,
          c.note,
          c.comboId,
          c.comboName,
        ],
      );
      for (let i = 0; i < c.selected.length; i++) {
        const m = c.selected[i];
        await client.query(
          `INSERT INTO pos_order_item_modifiers
             (order_item_id, modifier_id, modifier_name, price_delta, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [itemRows[0].id, m.id, m.name, m.priceDelta, i],
        );
      }
    }

    await client.query("COMMIT");
    const items = await loadOrderItems([orderId]);
    return mapOrder(orderRows[0], items.get(orderId) ?? []);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export class PosBillNotFoundForTicketError extends Error {
  constructor() {
    super("bill not found for kitchen ticket");
    this.name = "PosBillNotFoundForTicketError";
  }
}

/**
 * ตั๋วครัวจากบิล walk-in ที่จ่ายแล้ว — channel 'pos', เริ่มที่ accepted (จ่ายแล้ว
 * ไม่ต้องรอร้านยืนยัน) items ก็อปจาก snapshot ของบิล (ชื่อ/จำนวน/ตัวเลือก)
 * Idempotent: บิลเดียวมีตั๋วได้ใบเดียว — เรียกซ้ำคืนใบเดิม
 */
export async function createKitchenTicketFromBill(
  userId: string,
  billId: string,
): Promise<PosOrder> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // มีตั๋วอยู่แล้ว → คืนใบเดิม
    const { rows: existing } = await client.query<OrderRow>(
      `SELECT ${ORDER_RETURN} FROM pos_orders
       WHERE user_id = $1 AND bill_id = $2`,
      [userId, billId],
    );
    if (existing[0]) {
      await client.query("COMMIT");
      const items = await loadOrderItems([existing[0].id]);
      return mapOrder(existing[0], items.get(existing[0].id) ?? []);
    }

    const { rows: bills } = await client.query<{
      id: string;
      bill_no: string;
      total_amount: string;
      status: string;
    }>(
      `SELECT id, bill_no, total_amount::text, status FROM pos_bills
       WHERE id = $2 AND user_id = $1 AND status = 'paid'`,
      [userId, billId],
    );
    if (!bills[0]) throw new PosBillNotFoundForTicketError();
    const bill = bills[0];

    const orderNo = await nextOrderNo(client, userId);
    const { rows: orderRows } = await client.query<OrderRow>(
      `INSERT INTO pos_orders
         (user_id, order_no, status, channel, customer_name, total_amount, bill_id)
       VALUES ($1, $2, 'accepted', 'pos', $3, $4, $5)
       RETURNING ${ORDER_RETURN}`,
      [userId, orderNo, `หน้าร้าน ${bill.bill_no}`, bill.total_amount, billId],
    );
    const orderId = orderRows[0].id;

    // ก็อป items + ตัวเลือกจาก snapshot ของบิล
    const { rows: billItems } = await client.query<{
      id: string;
      product_id: string | null;
      product_name: string;
      unit_sell_price: string;
      quantity: string;
      line_total: string;
      sort_order: number;
      note: string | null;
    }>(
      `SELECT id, product_id, product_name, unit_sell_price::text,
              quantity::text, line_total::text, sort_order, note
       FROM pos_bill_items WHERE bill_id = $1
       ORDER BY sort_order ASC`,
      [billId],
    );

    for (const bi of billItems) {
      const { rows: itemRows } = await client.query<{ id: string }>(
        `INSERT INTO pos_order_items
           (order_id, product_id, product_name, unit_sell_price, quantity, line_total,
            sort_order, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          orderId,
          bi.product_id,
          bi.product_name,
          bi.unit_sell_price,
          bi.quantity,
          bi.line_total,
          bi.sort_order,
          bi.note,
        ],
      );
      await client.query(
        `INSERT INTO pos_order_item_modifiers
           (order_item_id, modifier_id, modifier_name, price_delta, sort_order)
         SELECT $1, bim.modifier_id, bim.modifier_name, bim.price_delta, bim.sort_order
         FROM pos_bill_item_modifiers bim
         WHERE bim.bill_item_id = $2`,
        [itemRows[0].id, bi.id],
      );
    }

    await client.query("COMMIT");
    const items = await loadOrderItems([orderId]);
    return mapOrder(orderRows[0], items.get(orderId) ?? []);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function loadOrderItems(
  orderIds: string[],
): Promise<Map<string, PosOrderItem[]>> {
  if (orderIds.length === 0) return new Map();
  const [{ rows: itemRows }, { rows: modRows }] = await Promise.all([
    pool.query<{
      id: string;
      order_id: string;
      product_id: string | null;
      product_name: string;
      unit_sell_price: string;
      quantity: string;
      line_total: string;
      sort_order: number;
      note: string | null;
      combo_id: string | null;
      combo_name: string | null;
    }>(
      `SELECT id, order_id, product_id, product_name,
              unit_sell_price::text, quantity::text, line_total::text, sort_order, note,
              combo_id, combo_name
       FROM pos_order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY sort_order ASC`,
      [orderIds],
    ),
    pool.query<{
      order_item_id: string;
      modifier_id: string | null;
      modifier_name: string;
      price_delta: string;
    }>(
      `SELECT m.order_item_id, m.modifier_id, m.modifier_name, m.price_delta::text AS price_delta
       FROM pos_order_item_modifiers m
       JOIN pos_order_items i ON i.id = m.order_item_id
       WHERE i.order_id = ANY($1::uuid[])
       ORDER BY m.sort_order ASC`,
      [orderIds],
    ),
  ]);

  const modsByItem = new Map<string, { names: PosOrderItemModifier[]; ids: string[] }>();
  for (const m of modRows) {
    const entry = modsByItem.get(m.order_item_id) ?? { names: [], ids: [] };
    entry.names.push({ modifierName: m.modifier_name, priceDelta: m.price_delta });
    if (m.modifier_id) entry.ids.push(m.modifier_id);
    modsByItem.set(m.order_item_id, entry);
  }

  const byOrder = new Map<string, PosOrderItem[]>();
  for (const r of itemRows) {
    const mods = modsByItem.get(r.id);
    const item: PosOrderItem = {
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      unitSellPrice: r.unit_sell_price,
      quantity: r.quantity,
      lineTotal: r.line_total,
      sortOrder: r.sort_order,
      note: r.note,
      comboId: r.combo_id,
      comboName: r.combo_name,
      ...(mods?.names.length ? { modifiers: mods.names, modifierIds: mods.ids } : {}),
    };
    const arr = byOrder.get(r.order_id) ?? [];
    arr.push(item);
    byOrder.set(r.order_id, arr);
  }
  return byOrder;
}

/** Customer-facing lookup (safe fields only) + shop name for display. */
export async function getOrderByAccessToken(
  accessToken: string,
): Promise<
  | (PosOrder & {
      shopName: string;
      hasFeedback: boolean;
      promptpayId: string | null;
      shopPhone: string | null;
      shopQrUrl: string | null;
      shopQrNote: string | null;
      /** สมาชิก (ถ้าออเดอร์ผูกอยู่) — ทำให้หน้าติดตามออเดอร์เป็นตัวเชื่อม account */
      loyalty: {
        memberCardToken: string;
        memberName: string | null;
        /** แต้มที่ได้จากบิลของออเดอร์นี้ (0 = ยังไม่ปิดบิล/ไม่เข้าเงื่อนไข) */
        pointsEarned: number;
        pointsBalance: number;
        redeemPoints: number;
        rewardNote: string | null;
      } | null;
      /** token เมนูร้าน — ปุ่ม "สั่งอีกครั้ง" กลับเข้าแอป */
      publicMenuToken: string | null;
    })
  | null
> {
  const { rows } = await pool.query<
    OrderRow & {
      shop_name: string;
      has_feedback: boolean;
      promptpay_id: string | null;
      shop_phone: string | null;
      shop_qr_url: string | null;
      shop_qr_note: string | null;
      public_menu_token: string | null;
      member_id: string | null;
      member_name: string | null;
      member_points: number | null;
      member_card_token: string | null;
      redeem_points: number | null;
      reward_note: string | null;
      points_earned: number | null;
    }
  >(
    `SELECT o.id, o.order_no, o.status, o.channel, o.customer_name, o.customer_phone, o.note,
            o.pickup_at_text, o.total_amount::text AS total_amount, o.bill_id,
            o.cancel_reason, o.created_at, o.payment_intent, o.slip_url,
            o.slip_uploaded_at, o.slip_verified_at, o.slip_rejected_reason,
            o.order_type, o.delivery_address, o.delivery_note,
            o.delivery_lat::text AS delivery_lat, o.delivery_lng::text AS delivery_lng,
            o.delivery_accuracy_m::text AS delivery_accuracy_m,
            o.delivery_fee::text AS delivery_fee,
            u.shop_name, s.promptpay_id, s.shop_phone, s.shop_qr_url, s.shop_qr_note,
            s.public_menu_token, COALESCE(s.redeem_points, 100) AS redeem_points, s.reward_note,
            o.member_id, m.name AS member_name, m.points AS member_points,
            m.access_token AS member_card_token,
            (SELECT COALESCE(SUM(e.delta), 0)::int FROM pos_point_events e
             WHERE e.bill_id = o.bill_id AND e.reason = 'earn') AS points_earned,
            EXISTS (SELECT 1 FROM pos_order_feedback f WHERE f.order_id = o.id) AS has_feedback
     FROM pos_orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN pos_shop_settings s ON s.user_id = o.user_id
     LEFT JOIN pos_members m ON m.id = o.member_id AND m.is_active = true
     WHERE o.access_token = $1`,
    [accessToken],
  );
  if (!rows[0]) return null;
  const items = await loadOrderItems([rows[0].id]);
  return {
    ...mapOrder(rows[0], items.get(rows[0].id) ?? []),
    shopName: rows[0].shop_name,
    hasFeedback: rows[0].has_feedback,
    promptpayId: rows[0].promptpay_id,
    shopPhone: rows[0].shop_phone,
    shopQrUrl: rows[0].shop_qr_url,
    shopQrNote: rows[0].shop_qr_note,
    /**
     * ⚠️ trade-off ที่ตั้งใจ: การส่ง member_card_token ผ่าน order token แปลว่า
     * "ใครถือลิงก์ออเดอร์ = เข้าบัตรของคนสั่งได้" — ยอมรับได้เพราะลิงก์ออเดอร์
     * เป็นของส่วนตัวอยู่แล้ว (มีชื่อ/ที่อยู่/แชท) และนี่คือกลไกเดียวที่ทำให้
     * account ก่อตัวเองโดยไม่ต้องสมัคร/OTP · การแลกแต้มยังต้องสแกนที่ร้านเสมอ
     */
    loyalty:
      rows[0].member_id && rows[0].member_card_token
        ? {
            memberCardToken: rows[0].member_card_token,
            memberName: rows[0].member_name,
            pointsEarned: rows[0].points_earned ?? 0,
            pointsBalance: rows[0].member_points ?? 0,
            redeemPoints: rows[0].redeem_points ?? 100,
            rewardNote: rows[0].reward_note,
          }
        : null,
    publicMenuToken: rows[0].public_menu_token,
  };
}

// ---------------------------------------------------------------------------
// สลิปโอนเงิน (ลูกค้าโอนก่อน) — ไม่มีผลต่อบัญชี รายรับเกิดตอน closeBill เท่านั้น
// ---------------------------------------------------------------------------

export class PosSlipNotAllowedError extends Error {
  constructor() {
    super("slip not allowed for this order");
    this.name = "PosSlipNotAllowedError";
  }
}

/** ลูกค้าแนบสลิป (public — ยืนยันด้วย access_token) */
export async function attachOrderSlip(
  accessToken: string,
  slipUrl: string,
): Promise<{ orderId: string; userId: string; orderNo: string } | null> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    order_no: string;
    status: string;
  }>(
    `SELECT id, user_id, order_no, status FROM pos_orders WHERE access_token = $1`,
    [accessToken],
  );
  const order = rows[0];
  if (!order) return null;
  if (order.status === "cancelled" || order.status === "completed") {
    throw new PosSlipNotAllowedError();
  }

  await pool.query(
    `UPDATE pos_orders
     SET slip_url = $2, slip_uploaded_at = now(), slip_verified_at = NULL,
         slip_rejected_reason = NULL, payment_intent = 'prepaid_transfer',
         updated_at = now()
     WHERE id = $1`,
    [order.id, slipUrl],
  );
  return { orderId: order.id, userId: order.user_id, orderNo: order.order_no };
}

/** พนักงานตรวจสลิป — approve = ยืนยันว่าเงินเข้าจริง (ยังไม่ลงบัญชี) */
export async function reviewOrderSlip(
  userId: string,
  orderId: string,
  input: { approve: boolean; reason?: string },
): Promise<PosOrder | null> {
  const { rows } = await pool.query<OrderRow>(
    `UPDATE pos_orders
     SET slip_verified_at = CASE WHEN $3 THEN now() ELSE NULL END,
         slip_rejected_reason = CASE WHEN $3 THEN NULL ELSE $4 END,
         updated_at = now()
     WHERE id = $1 AND user_id = $2 AND slip_url IS NOT NULL
     RETURNING ${ORDER_RETURN}`,
    [orderId, userId, input.approve, input.reason ?? "สลิปไม่ถูกต้อง"],
  );
  if (!rows[0]) return null;
  const items = await loadOrderItems([rows[0].id]);
  return mapOrder(rows[0], items.get(rows[0].id) ?? []);
}

/**
 * สลับจังหวะเก็บเงินรายออเดอร์ — ทำได้เฉพาะตอนยังไม่มีบิล
 * (มีบิลแล้วแปลว่าเก็บเงินไปแล้ว การเปลี่ยนจังหวะไม่มีความหมาย)
 */
export async function setOrderPaymentTiming(
  userId: string,
  orderId: string,
  timing: "before" | "after",
): Promise<PosOrder> {
  const { rows } = await pool.query<OrderRow>(
    `UPDATE pos_orders
     SET payment_timing = $3, updated_at = now()
     WHERE id = $2 AND user_id = $1 AND bill_id IS NULL
       AND status NOT IN ('completed', 'cancelled')
     RETURNING ${ORDER_RETURN}`,
    [userId, orderId, timing],
  );
  if (!rows[0]) throw new PosOrderNotFoundError();
  const items = await loadOrderItems([orderId]);
  return mapOrder(rows[0], items.get(orderId) ?? []);
}

/** Staff queue. active=true → pending/accepted/cooking/ready (ยังไม่ส่งมอบ). */
export async function listPosOrders(
  userId: string,
  opts?: { activeOnly?: boolean; limit?: number },
): Promise<PosOrder[]> {
  const statusFilter = opts?.activeOnly
    ? ` AND status IN ('pending', 'accepted', 'cooking', 'ready')`
    : "";
  const { rows } = await pool.query<OrderRow & { customer_msg_count: string }>(
    `SELECT ${ORDER_RETURN},
            (SELECT COUNT(*) FROM pos_order_messages m
             WHERE m.order_id = pos_orders.id AND m.sender = 'customer')::text
              AS customer_msg_count
     FROM pos_orders
     WHERE user_id = $1${statusFilter}
     ORDER BY created_at ASC
     LIMIT $2`,
    [userId, Math.min(opts?.limit ?? 100, 200)],
  );
  const items = await loadOrderItems(rows.map((r) => r.id));
  return attachRiderNames(
    rows.map((r) => ({
      ...mapOrder(r, items.get(r.id) ?? []),
      customerMsgCount: Number(r.customer_msg_count) || 0,
    })),
  );
}

const ALLOWED_TRANSITIONS: Record<PosOrderStatus, PosOrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["cooking", "ready", "cancelled"],
  cooking: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function updatePosOrderStatus(
  userId: string,
  orderId: string,
  input: { status: PosOrderStatus; cancelReason?: string; billId?: string },
): Promise<PosOrder> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OrderRow>(
      `SELECT ${ORDER_RETURN} FROM pos_orders
       WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, orderId],
    );
    if (!rows[0]) throw new PosOrderNotFoundError();
    const current = rows[0].status as PosOrderStatus;
    if (!ALLOWED_TRANSITIONS[current].includes(input.status)) {
      throw new PosOrderTransitionError();
    }

    // รู A: เก็บเงินแล้วห้ามยกเลิกออเดอร์เฉยๆ — ต้องยกเลิกบิลก่อน (คืนสต็อก + ตัดรายได้ออก)
    // บิลที่ void แล้วไม่บล็อก — รายได้/สต็อกถูกย้อนแล้ว ยกเลิกออเดอร์ได้ตามเช็คลิสต์ข้อ 8
    if (input.status === "cancelled" && rows[0].bill_id) {
      const { rows: linkedBill } = await client.query<{ status: string }>(
        `SELECT status FROM pos_bills WHERE id = $1 AND user_id = $2`,
        [rows[0].bill_id, userId],
      );
      if (linkedBill[0]?.status === "paid") {
        throw new PosOrderHasBillError(rows[0].bill_id);
      }
    }

    const cancelReason =
      input.status === "cancelled" ? (input.cancelReason ?? null) : null;

    const { rows: updated } = await client.query<OrderRow>(
      `UPDATE pos_orders
       SET status = $3,
           cancel_reason = COALESCE($4, cancel_reason),
           bill_id = COALESCE($5, bill_id),
           updated_at = now()
       WHERE id = $2 AND user_id = $1
       RETURNING ${ORDER_RETURN}`,
      [userId, orderId, input.status, cancelReason, input.billId ?? null],
    );
    await client.query("COMMIT");

    // แจ้งเตือนลูกค้าบนมือถือ (fire-and-forget — ห้ามทำให้ flow พัง)
    void pushOrderStatus(orderId, input.status, updated[0].order_no);

    // งานส่งพร้อมออกรถ → เตือนคนส่งทุกคน (dynamic import: rider-queries import ไฟล์นี้กลับ)
    if (input.status === "ready" && updated[0].order_type === "delivery") {
      const row = updated[0];
      void import("@/lib/pos-rider-queries")
        .then((m) =>
          m.pushRidersNewJob(
            userId,
            row.order_no,
            row.total_amount,
            row.payment_intent !== "prepaid_transfer",
          ),
        )
        .catch(() => {});
    }

    const items = await loadOrderItems([orderId]);
    return mapOrder(updated[0], items.get(orderId) ?? []);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
