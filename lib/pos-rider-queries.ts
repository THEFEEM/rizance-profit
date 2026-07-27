import webpush from "web-push";
import { pool } from "@/lib/db";
import { sumDecimals } from "@/lib/money";
import {
  PosOrderNotFoundError,
  PosOrderTransitionError,
  listPosOrders,
  updatePosOrderStatus,
  type PosOrder,
} from "@/lib/pos-order-queries";
import { closePosBill } from "@/lib/pos-close-bill-queries";
import { isPushConfigured } from "@/lib/pos-push-queries";

/**
 * โหมดไรเดอร์ — คนไปส่งเข้าผ่านลิงก์ส่วนตัว /r/<access_token> ไม่มี session/JWT
 *
 * ขอบเขตที่ token นี้ทำได้ (แคบที่สุดเท่าที่ทำงานได้):
 *   - เห็นเฉพาะออเดอร์ order_type = 'delivery' ของร้านตัวเอง
 *   - กด "รับงาน" (claim) และ "ส่งสำเร็จ" (deliver) เท่านั้น
 *   - ห้ามแก้เมนู/ราคา/สต็อก/ตั้งค่าร้าน — ไม่มี endpoint ให้เลย
 *
 * ⚠️ deliver → เรียก closePosBill ตัวเดิม (invariant เดิมทุกประการ)
 */

export class RiderNotFoundError extends Error {
  constructor() {
    super("rider not found");
    this.name = "RiderNotFoundError";
  }
}

export class RiderJobTakenError extends Error {
  constructor(public riderName: string) {
    super("job already claimed");
    this.name = "RiderJobTakenError";
  }
}

export type Rider = {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  accessToken: string;
  isActive: boolean;
  createdAt: string;
};

type RiderRow = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  access_token: string;
  is_active: boolean;
  created_at: Date | string;
};

function mapRider(r: RiderRow): Rider {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    phone: r.phone,
    accessToken: r.access_token,
    isActive: r.is_active,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

const RIDER_RETURN = `id, user_id, name, phone, access_token, is_active, created_at`;

// ── ฝั่งเจ้าของร้าน (ต้องมี session POS) ─────────────────────────

export async function listRiders(userId: string): Promise<Rider[]> {
  const { rows } = await pool.query<RiderRow>(
    `SELECT ${RIDER_RETURN} FROM pos_riders
     WHERE user_id = $1 ORDER BY is_active DESC, created_at ASC`,
    [userId],
  );
  return rows.map(mapRider);
}

export async function createRider(
  userId: string,
  input: { name: string; phone?: string | null },
): Promise<Rider> {
  const { rows } = await pool.query<RiderRow>(
    `INSERT INTO pos_riders (user_id, name, phone)
     VALUES ($1, $2, $3)
     RETURNING ${RIDER_RETURN}`,
    [userId, input.name, input.phone ?? null],
  );
  return mapRider(rows[0]);
}

export async function updateRider(
  userId: string,
  riderId: string,
  input: { name?: string; phone?: string | null; isActive?: boolean; rotateToken?: boolean },
): Promise<Rider> {
  const { rows } = await pool.query<RiderRow>(
    `UPDATE pos_riders
     SET name         = COALESCE($3, name),
         phone        = CASE WHEN $4::boolean THEN $5 ELSE phone END,
         is_active    = COALESCE($6, is_active),
         access_token = CASE WHEN $7::boolean THEN gen_random_uuid() ELSE access_token END,
         updated_at   = now()
     WHERE id = $2 AND user_id = $1
     RETURNING ${RIDER_RETURN}`,
    [
      userId,
      riderId,
      input.name ?? null,
      input.phone !== undefined,
      input.phone ?? null,
      input.isActive ?? null,
      input.rotateToken === true,
    ],
  );
  if (!rows[0]) throw new RiderNotFoundError();
  return mapRider(rows[0]);
}

export async function deleteRider(userId: string, riderId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `DELETE FROM pos_riders WHERE id = $2 AND user_id = $1`,
    [userId, riderId],
  );
  if (!rowCount) throw new RiderNotFoundError();
}

/** ยอดเงินสดที่ยังอยู่กับคนส่งแต่ละคน (ส่งถึงแล้ว · จ่ายสด · ยังไม่คืนเงินร้าน) */
export type RiderCashHolding = {
  riderId: string;
  riderName: string;
  orderCount: number;
  amount: string;
};

export async function listRiderCashHoldings(userId: string): Promise<RiderCashHolding[]> {
  const { rows } = await pool.query<{
    rider_id: string;
    name: string;
    order_count: string;
    amount: string;
  }>(
    `SELECT o.rider_id, r.name,
            COUNT(*)::text AS order_count,
            COALESCE(SUM(o.total_amount), 0)::text AS amount
     FROM pos_orders o
     JOIN pos_riders r ON r.id = o.rider_id
     WHERE o.user_id = $1
       AND o.order_type = 'delivery'
       AND o.status = 'completed'
       AND o.delivered_at IS NOT NULL
       AND o.cash_settled_at IS NULL
       AND o.payment_intent <> 'prepaid_transfer'
     GROUP BY o.rider_id, r.name
     ORDER BY r.name`,
    [userId],
  );
  return rows.map((r) => ({
    riderId: r.rider_id,
    riderName: r.name,
    orderCount: Number(r.order_count),
    amount: r.amount,
  }));
}

/** ร้านกดยืนยันว่ารับเงินสดจากคนส่งครบแล้ว — ประทับเวลาอย่างเดียว ไม่ลง journal ซ้ำ */
export async function settleRiderCash(userId: string, riderId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE pos_orders
     SET cash_settled_at = now(), updated_at = now()
     WHERE user_id = $1 AND rider_id = $2
       AND order_type = 'delivery' AND status = 'completed'
       AND delivered_at IS NOT NULL AND cash_settled_at IS NULL
       AND payment_intent <> 'prepaid_transfer'`,
    [userId, riderId],
  );
  return rowCount ?? 0;
}

// ── ฝั่งคนส่ง (token เท่านั้น) ────────────────────────────────────

export async function getRiderByToken(token: string): Promise<Rider | null> {
  const { rows } = await pool.query<RiderRow>(
    `SELECT ${RIDER_RETURN} FROM pos_riders WHERE access_token = $1 AND is_active = true`,
    [token],
  );
  return rows[0] ? mapRider(rows[0]) : null;
}

export type RiderBoard = {
  rider: { id: string; name: string };
  shopName: string;
  /** งานที่ยังไม่มีใครรับ (ร้านทำเสร็จแล้ว พร้อมออกรถ) */
  available: PosOrder[];
  /** งานของฉัน — รับแล้วแต่ยังไม่ส่งถึง */
  mine: PosOrder[];
  /** ส่งสำเร็จวันนี้ */
  doneToday: PosOrder[];
  /** เงินสดที่ยังติดตัวอยู่ (ยังไม่ได้คืนร้าน) */
  cashOnHand: { amount: string; orderCount: number };
};

export async function getRiderBoard(rider: Rider): Promise<RiderBoard> {
  const [orders, shop] = await Promise.all([
    listPosOrders(rider.userId, { limit: 200 }),
    pool.query<{ shop_name: string }>(
      `SELECT COALESCE(u.shop_name, 'ร้านของฉัน') AS shop_name
       FROM users u WHERE u.id = $1`,
      [rider.userId],
    ),
  ]);

  const delivery = orders.filter((o) => o.orderType === "delivery");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // งานว่าง = ร้านทำเสร็จแล้ว (ready) ยังไม่มีใครรับ
  const available = delivery.filter((o) => o.status === "ready" && !o.riderId);
  const mine = delivery.filter(
    (o) => o.riderId === rider.id && o.status !== "completed" && o.status !== "cancelled",
  );
  const doneToday = delivery.filter(
    (o) =>
      o.riderId === rider.id &&
      o.status === "completed" &&
      o.deliveredAt != null &&
      new Date(o.deliveredAt) >= startOfToday,
  );

  const unsettled = delivery.filter(
    (o) =>
      o.riderId === rider.id &&
      o.status === "completed" &&
      o.deliveredAt != null &&
      o.cashSettledAt == null &&
      o.paymentIntent !== "prepaid_transfer",
  );

  return {
    rider: { id: rider.id, name: rider.name },
    shopName: shop.rows[0]?.shop_name ?? "ร้านของฉัน",
    available,
    mine,
    doneToday,
    cashOnHand: {
      amount: sumDecimals(...unsettled.map((o) => o.totalAmount)),
      orderCount: unsettled.length,
    },
  };
}

/** กดรับงาน — คนแรกที่กดได้ไป (atomic: WHERE rider_id IS NULL) */
export async function claimRiderJob(rider: Rider, orderId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE pos_orders
     SET rider_id = $3, picked_up_at = now(), updated_at = now()
     WHERE id = $2 AND user_id = $1
       AND order_type = 'delivery'
       AND status = 'ready'
       AND rider_id IS NULL`,
    [rider.userId, orderId, rider.id],
  );
  if (rowCount) return;

  // ไม่สำเร็จ → บอกให้ชัดว่าเพราะอะไร
  const { rows } = await pool.query<{ rider_name: string | null; status: string }>(
    `SELECT r.name AS rider_name, o.status
     FROM pos_orders o LEFT JOIN pos_riders r ON r.id = o.rider_id
     WHERE o.id = $2 AND o.user_id = $1`,
    [rider.userId, orderId],
  );
  if (!rows[0]) throw new PosOrderNotFoundError();
  if (rows[0].rider_name) throw new RiderJobTakenError(rows[0].rider_name);
  throw new PosOrderTransitionError();
}

/** ปล่อยงานคืนกอง (กดผิด / ไปส่งไม่ได้) */
export async function releaseRiderJob(rider: Rider, orderId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE pos_orders
     SET rider_id = NULL, picked_up_at = NULL, updated_at = now()
     WHERE id = $2 AND user_id = $1 AND rider_id = $3 AND status = 'ready'`,
    [rider.userId, orderId, rider.id],
  );
  if (!rowCount) throw new PosOrderNotFoundError();
}

export type DeliverResult = { billNo: string; totalAmount: string };

/**
 * ส่งสำเร็จ → ปิดบิลจริง (รายได้ + journal + ตัดสต็อก) แล้วปิดออเดอร์
 * วิธีจ่ายมาจากออเดอร์เอง: โอนมาก่อน = promptpay · ที่เหลือ = cash (เก็บปลายทาง)
 */
export async function deliverRiderJob(
  rider: Rider,
  orderId: string,
): Promise<DeliverResult> {
  const orders = await listPosOrders(rider.userId, { limit: 200 });
  const order = orders.find((o) => o.id === orderId);
  if (!order || order.orderType !== "delivery") throw new PosOrderNotFoundError();
  if (order.riderId !== rider.id) throw new PosOrderNotFoundError();
  if (order.status !== "ready") throw new PosOrderTransitionError();

  const method = order.slipVerifiedAt ? "promptpay" : "cash";
  const total = Math.round(parseFloat(order.totalAmount) * 100) / 100;
  const fee = parseFloat(order.deliveryFee || "0");

  const result = await closePosBill(rider.userId, {
    items: order.items
      .filter((i) => i.productId)
      .map((i) => ({
        productId: i.productId!,
        qty: parseFloat(i.quantity),
        modifierIds: i.modifierIds?.length ? i.modifierIds : undefined,
        note: i.note?.trim() || undefined,
      })),
    surcharges: fee > 0 ? [{ label: "ค่าส่งเดลิเวอรี่", amount: fee }] : undefined,
    payments: [{ method, amount: total }],
  });

  await updatePosOrderStatus(rider.userId, orderId, {
    status: "completed",
    billId: result.bill.id,
  });
  await pool.query(
    `UPDATE pos_orders SET delivered_at = now(), updated_at = now() WHERE id = $1`,
    [orderId],
  );

  return { billNo: result.bill.billNo, totalAmount: result.bill.totalAmount };
}

// ── แจ้งเตือนคนส่ง ────────────────────────────────────────────────

export async function saveRiderPushSub(
  riderId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await pool.query(
    `INSERT INTO pos_rider_push_subs (rider_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (rider_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [riderId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

/**
 * มีงานส่งใหม่พร้อมออกรถ → เตือนคนส่งทุกคนของร้าน
 * fire-and-forget เหมือน pushOrderStatus — error ถูกกลืนหมด
 */
export async function pushRidersNewJob(
  userId: string,
  orderNo: string,
  totalAmount: string,
  isCod: boolean,
): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const { rows } = await pool.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      access_token: string;
    }>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, r.access_token
       FROM pos_rider_push_subs s
       JOIN pos_riders r ON r.id = s.rider_id
       WHERE r.user_id = $1 AND r.is_active = true`,
      [userId],
    );
    if (rows.length === 0) return;

    const base = process.env.NEXT_PUBLIC_POS_APP_URL?.trim() || "https://pos.rizance.app";
    const stale: string[] = [];

    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification(
            { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            JSON.stringify({
              title: `🛵 งานส่งใหม่ · ${orderNo}`,
              body: isCod
                ? `เก็บเงินปลายทาง ฿${totalAmount} — แตะเพื่อรับงาน`
                : `ชำระแล้ว ฿${totalAmount} — แตะเพื่อรับงาน`,
              url: `${base}/r/${r.access_token}`,
              tag: `rider-job`,
            }),
            { TTL: 1800, urgency: "high" },
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) stale.push(r.id);
        }
      }),
    );

    if (stale.length > 0) {
      await pool.query(`DELETE FROM pos_rider_push_subs WHERE id = ANY($1::uuid[])`, [stale]);
    }
  } catch {
    // nice-to-have
  }
}
