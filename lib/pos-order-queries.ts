import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { today } from "@/lib/date";
import { centsToDecimalString, sumDecimals, toCents } from "@/lib/money";
import { resolveCartModifiers, type SelectedModifier } from "@/lib/pos-modifier-queries";

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
  items: PosOrderItem[];
};

export type PublicOrderResult = {
  orderNo: string;
  accessToken: string;
  totalAmount: string;
};

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
};

const ORDER_RETURN = `id, order_no, status, channel, customer_name, customer_phone, note,
  pickup_at_text, total_amount::text AS total_amount, bill_id, cancel_reason, created_at`;

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
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
    items,
  };
}

export async function getShopByMenuToken(
  token: string,
): Promise<{ userId: string; shopName: string; onlineOrderingEnabled: boolean } | null> {
  const { rows } = await pool.query<{
    user_id: string;
    shop_name: string;
    online_ordering_enabled: boolean;
  }>(
    `SELECT s.user_id, u.shop_name, s.online_ordering_enabled
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
  };
}

async function nextOrderNo(client: PoolClient, userId: string): Promise<string> {
  const counterDate = today();
  await client.query(
    `INSERT INTO pos_order_counters (user_id, counter_date, last_seq)
     VALUES ($1, $2::date, 0)
     ON CONFLICT (user_id, counter_date) DO NOTHING`,
    [userId, counterDate],
  );
  await client.query(
    `SELECT last_seq FROM pos_order_counters
     WHERE user_id = $1 AND counter_date = $2::date FOR UPDATE`,
    [userId, counterDate],
  );
  const { rows } = await client.query<{ last_seq: number }>(
    `UPDATE pos_order_counters SET last_seq = last_seq + 1
     WHERE user_id = $1 AND counter_date = $2::date
     RETURNING last_seq`,
    [userId, counterDate],
  );
  return `Q${counterDate.replace(/-/g, "").slice(2)}-${String(rows[0].last_seq).padStart(3, "0")}`;
}

export type CreatePublicOrderInput = {
  customerName?: string;
  customerPhone?: string;
  note?: string;
  pickupAtText?: string;
  items: { productId: string; qty: number; modifierIds?: string[] }[];
};

/** Create a pre-order — prices resolved server-side, snapshot into order rows. */
export async function createPublicOrder(
  userId: string,
  input: CreatePublicOrderInput,
): Promise<PublicOrderResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productIds = [...new Set(input.items.map((i) => i.productId))];
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

    const computed = input.items.map((line, sortOrder) => {
      const product = products.get(line.productId)!;
      const selected: SelectedModifier[] = modifiersByLine.get(sortOrder) ?? [];
      const unitCents =
        toCents(product.sell_price) + selected.reduce((s, m) => s + toCents(m.priceDelta), 0);
      const lineCents = Math.round((unitCents * Math.round(line.qty * 1000)) / 1000);
      return {
        line,
        product,
        selected,
        unitSellPrice: centsToDecimalString(unitCents),
        lineTotal: centsToDecimalString(lineCents),
        sortOrder,
      };
    });

    const totalAmount = sumDecimals(...computed.map((c) => c.lineTotal));
    const orderNo = await nextOrderNo(client, userId);

    const { rows: orderRows } = await client.query<{ id: string; access_token: string }>(
      `INSERT INTO pos_orders
         (user_id, order_no, customer_name, customer_phone, note, pickup_at_text, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, access_token`,
      [
        userId,
        orderNo,
        input.customerName?.trim() || "ลูกค้า QR",
        input.customerPhone ?? null,
        input.note ?? null,
        input.pickupAtText ?? null,
        totalAmount,
      ],
    );
    const orderId = orderRows[0].id;

    for (const c of computed) {
      const { rows: itemRows } = await client.query<{ id: string }>(
        `INSERT INTO pos_order_items
           (order_id, product_id, product_name, unit_sell_price, quantity, line_total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [orderId, c.product.id, c.product.name, c.unitSellPrice, c.line.qty, c.lineTotal, c.sortOrder],
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
    return { orderNo, accessToken: orderRows[0].access_token, totalAmount };
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
    }>(
      `SELECT id, product_id, product_name, unit_sell_price::text,
              quantity::text, line_total::text, sort_order
       FROM pos_bill_items WHERE bill_id = $1
       ORDER BY sort_order ASC`,
      [billId],
    );

    for (const bi of billItems) {
      const { rows: itemRows } = await client.query<{ id: string }>(
        `INSERT INTO pos_order_items
           (order_id, product_id, product_name, unit_sell_price, quantity, line_total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [orderId, bi.product_id, bi.product_name, bi.unit_sell_price, bi.quantity, bi.line_total, bi.sort_order],
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
    }>(
      `SELECT id, order_id, product_id, product_name,
              unit_sell_price::text, quantity::text, line_total::text, sort_order
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
): Promise<(PosOrder & { shopName: string }) | null> {
  const { rows } = await pool.query<OrderRow & { shop_name: string }>(
    `SELECT o.id, o.order_no, o.status, o.customer_name, o.customer_phone, o.note,
            o.pickup_at_text, o.total_amount::text AS total_amount, o.bill_id,
            o.cancel_reason, o.created_at, u.shop_name
     FROM pos_orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.access_token = $1`,
    [accessToken],
  );
  if (!rows[0]) return null;
  const items = await loadOrderItems([rows[0].id]);
  return { ...mapOrder(rows[0], items.get(rows[0].id) ?? []), shopName: rows[0].shop_name };
}

/** Staff queue. active=true → pending/accepted/cooking/ready (ยังไม่ส่งมอบ). */
export async function listPosOrders(
  userId: string,
  opts?: { activeOnly?: boolean; limit?: number },
): Promise<PosOrder[]> {
  const statusFilter = opts?.activeOnly
    ? ` AND status IN ('pending', 'accepted', 'cooking', 'ready')`
    : "";
  const { rows } = await pool.query<OrderRow>(
    `SELECT ${ORDER_RETURN}
     FROM pos_orders
     WHERE user_id = $1${statusFilter}
     ORDER BY created_at ASC
     LIMIT $2`,
    [userId, Math.min(opts?.limit ?? 100, 200)],
  );
  const items = await loadOrderItems(rows.map((r) => r.id));
  return rows.map((r) => mapOrder(r, items.get(r.id) ?? []));
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

    const items = await loadOrderItems([orderId]);
    return mapOrder(updated[0], items.get(orderId) ?? []);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
