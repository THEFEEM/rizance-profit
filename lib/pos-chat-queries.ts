import webpush from "web-push";
import { pool } from "@/lib/db";
import { ensurePushReady } from "@/lib/pos-push-queries";

/**
 * แชทในออเดอร์ — ลูกค้า ↔ ร้าน ↔ คนส่ง (สไตล์ Grab)
 * ทุกฝั่ง poll สั้นๆ ระหว่างเปิดแชท + push เมื่อมีข้อความใหม่ถึงลูกค้า/คนส่ง
 */

export type OrderMessageSender = "customer" | "shop" | "rider";

export type OrderMessage = {
  id: string;
  sender: OrderMessageSender;
  /** ชื่อคนส่ง (เฉพาะ sender = rider) */
  riderName: string | null;
  kind: "chat" | "proof";
  body: string | null;
  imageUrl: string | null;
  createdAt: string;
};

type MessageRow = {
  id: string;
  sender: string;
  rider_name: string | null;
  kind: string;
  body: string | null;
  image_url: string | null;
  created_at: Date | string;
};

function mapMessage(r: MessageRow): OrderMessage {
  return {
    id: r.id,
    sender: r.sender as OrderMessageSender,
    riderName: r.rider_name,
    kind: (r.kind as OrderMessage["kind"]) ?? "chat",
    body: r.body,
    imageUrl: r.image_url,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

const MESSAGE_RETURN = `m.id, m.sender, r.name AS rider_name, m.kind, m.body, m.image_url, m.created_at`;

/** ดึงข้อความของออเดอร์ (after = โหลดเฉพาะที่ใหม่กว่า สำหรับ polling) */
export async function listOrderMessages(
  orderId: string,
  after?: string,
): Promise<OrderMessage[]> {
  const params: unknown[] = [orderId];
  let filter = "";
  if (after) {
    params.push(after);
    filter = ` AND m.created_at > $2`;
  }
  const { rows } = await pool.query<MessageRow>(
    `SELECT ${MESSAGE_RETURN}
     FROM pos_order_messages m
     LEFT JOIN pos_riders r ON r.id = m.rider_id
     WHERE m.order_id = $1${filter}
     ORDER BY m.created_at ASC
     LIMIT 200`,
    params,
  );
  return rows.map(mapMessage);
}

export type SendMessageInput = {
  sender: OrderMessageSender;
  riderId?: string;
  kind?: "chat" | "proof";
  body?: string;
  imageUrl?: string;
};

export async function addOrderMessage(
  orderId: string,
  input: SendMessageInput,
): Promise<OrderMessage> {
  const body = input.body?.trim() || null;
  const imageUrl = input.imageUrl ?? null;
  if (!body && !imageUrl) throw new Error("empty message");

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pos_order_messages (order_id, sender, rider_id, kind, body, image_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [orderId, input.sender, input.riderId ?? null, input.kind ?? "chat", body, imageUrl],
  );

  const { rows: out } = await pool.query<MessageRow>(
    `SELECT ${MESSAGE_RETURN}
     FROM pos_order_messages m
     LEFT JOIN pos_riders r ON r.id = m.rider_id
     WHERE m.id = $1`,
    [rows[0].id],
  );

  // แจ้งเตือน (fire-and-forget)
  void notifyNewMessage(orderId, mapMessage(out[0]));

  return mapMessage(out[0]);
}

/**
 * push ข้อความใหม่:
 *   ร้าน/คนส่งพิมพ์ → เด้งหาลูกค้า (subs ของออเดอร์)
 *   ลูกค้าพิมพ์     → เด้งหาคนส่งที่รับงานนี้ (subs ของ rider)
 * ฝั่งจอร้านใช้ polling + เสียงอยู่แล้ว ไม่ต้อง push
 */
async function notifyNewMessage(orderId: string, msg: OrderMessage): Promise<void> {
  // สำคัญ: ตั้งค่า VAPID ก่อนยิงเสมอ — instance ใหม่ของ serverless ยังไม่ถูกตั้งค่า
  if (!ensurePushReady()) {
    console.warn("[pos-chat] notifyNewMessage skipped — VAPID not configured");
    return;
  }
  try {
    const base = process.env.NEXT_PUBLIC_POS_APP_URL?.trim() || "https://pos.rizance.app";
    const preview = msg.body ?? (msg.kind === "proof" ? "📷 รูปหลักฐานการส่ง" : "📷 รูปภาพ");
    console.info("[pos-chat] notifyNewMessage", { orderId, sender: msg.sender });

    if (msg.sender === "customer") {
      // → คนส่งที่รับงานนี้
      const { rows } = await pool.query<{
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        access_token: string;
        order_no: string;
      }>(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth, r.access_token, o.order_no
         FROM pos_orders o
         JOIN pos_riders r ON r.id = o.rider_id
         JOIN pos_rider_push_subs s ON s.rider_id = r.id
         WHERE o.id = $1`,
        [orderId],
      );
      await fanout(
        rows.map((r) => ({
          sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          id: r.id,
          payload: JSON.stringify({
            title: `💬 ลูกค้า · ${r.order_no}`,
            body: preview,
            url: `${base}/r/${r.access_token}`,
            tag: `chat-${orderId}`,
          }),
        })),
        "pos_rider_push_subs",
      );
      return;
    }

    // ร้าน/คนส่ง → ลูกค้า
    const { rows } = await pool.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      access_token: string;
      order_no: string;
    }>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, o.access_token, o.order_no
       FROM pos_order_push_subs s
       JOIN pos_orders o ON o.id = s.order_id
       WHERE s.order_id = $1`,
      [orderId],
    );
    const from = msg.sender === "rider" ? (msg.riderName ?? "คนส่ง") : "ร้าน";
    await fanout(
      rows.map((r) => ({
        sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        id: r.id,
        payload: JSON.stringify({
          title: `💬 ${from} · ${r.order_no}`,
          body: preview,
          url: `${base}/o/${r.access_token}`,
          tag: `chat-${orderId}`,
        }),
      })),
      "pos_order_push_subs",
    );
  } catch (err) {
    // push เป็น nice-to-have — แต่ log ไว้เพื่อจับ cold-start / VAPID miss
    console.warn("[pos-chat] notifyNewMessage failed", err);
  }
}

async function fanout(
  targets: {
    sub: { endpoint: string; keys: { p256dh: string; auth: string } };
    id: string;
    payload: string;
  }[],
  table: "pos_order_push_subs" | "pos_rider_push_subs",
): Promise<void> {
  if (targets.length === 0) {
    console.info("[pos-chat] webpush skip — no subs", { table });
    return;
  }
  const stale: string[] = [];
  let ok = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification(t.sub, t.payload, { TTL: 1800, urgency: "high" });
        ok += 1;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) stale.push(t.id);
        else console.warn("[pos-chat] webpush send error", { table, code, err });
      }
    }),
  );
  console.info("[pos-chat] webpush done", { table, targets: targets.length, ok, stale: stale.length });
  if (stale.length > 0) {
    await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [stale]);
  }
}

// ── ตัวช่วยพิสูจน์สิทธิ์ ─────────────────────────────────────────

/** order id จาก access token ของลูกค้า */
export async function orderIdByAccessToken(token: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pos_orders WHERE access_token = $1`,
    [token],
  );
  return rows[0]?.id ?? null;
}

/** ออเดอร์เป็นของร้านนี้ไหม (ฝั่ง POS) */
export async function orderBelongsToUser(orderId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM pos_orders WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );
  return rows.length > 0;
}

/** คนส่งคุยได้เฉพาะงานเดลิเวอรี่ของร้านตัวเอง */
export async function orderVisibleToRider(
  orderId: string,
  riderUserId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM pos_orders
     WHERE id = $1 AND user_id = $2 AND order_type = 'delivery'`,
    [orderId, riderUserId],
  );
  return rows.length > 0;
}
