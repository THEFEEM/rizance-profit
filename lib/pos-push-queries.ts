import webpush from "web-push";
import { pool } from "@/lib/db";

/**
 * Web Push แจ้งเตือนลูกค้า QR (ไม่มีบัญชี → subscription ผูกกับ order โดยตรง)
 *
 * Env (server-only):
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  — สร้างครั้งเดียวด้วย `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT                          — mailto:dev@mitmaitri.co
 *   NEXT_PUBLIC_POS_APP_URL                — ใช้ประกอบลิงก์ในแจ้งเตือน
 *
 * หมายเหตุแพลตฟอร์ม: Android/Chrome ใช้ได้ทันที · iOS ต้อง "เพิ่มไปยังหน้าจอโฮม"
 * ก่อน (ข้อจำกัดของ Apple) — ถ้าไม่รองรับ หน้าเว็บยัง poll ทุก 10 วิเหมือนเดิม
 */

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim(),
  );
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

let configured = false;

function ensureConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || "mailto:dev@mitmaitri.co",
      process.env.VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim(),
    );
    configured = true;
  }
  return true;
}

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** เก็บ subscription ของเบราว์เซอร์ลูกค้า (idempotent ต่อ order+endpoint) */
export async function savePushSubscription(
  accessToken: string,
  sub: PushSubscriptionInput,
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pos_orders WHERE access_token = $1`,
    [accessToken],
  );
  if (!rows[0]) return false;

  await pool.query(
    `INSERT INTO pos_order_push_subs (order_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [rows[0].id, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
  return true;
}

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  accepted: { title: "ร้านรับออเดอร์แล้ว", body: "กำลังเตรียมของให้นะครับ" },
  cooking: { title: "กำลังทำอาหารอยู่", body: "อีกไม่นานพร้อมรับแล้ว" },
  ready: { title: "อาหารพร้อมแล้ว! 🍔", body: "มารับที่ร้านได้เลย แจ้งเลขคิวกับพนักงาน" },
  completed: { title: "ขอบคุณที่อุดหนุนครับ 🙏", body: "แตะเพื่อให้คะแนนร้าน" },
  cancelled: { title: "ออเดอร์ถูกยกเลิก", body: "ติดต่อร้านได้เลยถ้าสงสัย" },
};

/**
 * ยิง push ให้ทุกเบราว์เซอร์ที่ subscribe ออเดอร์นี้ไว้
 * fire-and-forget: ห้ามทำให้การเปลี่ยนสถานะพัง — error ถูกกลืนทั้งหมด
 */
export async function pushOrderStatus(
  orderId: string,
  status: string,
  orderNo: string,
  accessToken?: string,
): Promise<void> {
  if (!ensureConfigured()) return;
  const message = STATUS_MESSAGES[status];
  if (!message) return;

  try {
    const { rows } = await pool.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      access_token: string;
    }>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, o.access_token
       FROM pos_order_push_subs s
       JOIN pos_orders o ON o.id = s.order_id
       WHERE s.order_id = $1`,
      [orderId],
    );
    if (rows.length === 0) return;

    const base = process.env.NEXT_PUBLIC_POS_APP_URL?.trim() || "https://pos.rizance.app";
    const token = accessToken ?? rows[0].access_token;

    const payload = JSON.stringify({
      title: `${message.title} · ${orderNo}`,
      body: message.body,
      url: `${base}/o/${token}`,
      tag: `order-${orderId}`,
    });

    const stale: string[] = [];
    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification(
            { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            payload,
            { TTL: 1800, urgency: "high" },
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          // 404/410 = subscription หมดอายุ → ลบทิ้ง
          if (code === 404 || code === 410) stale.push(r.id);
        }
      }),
    );

    if (stale.length > 0) {
      await pool.query(`DELETE FROM pos_order_push_subs WHERE id = ANY($1::uuid[])`, [stale]);
    }
  } catch {
    // แจ้งเตือนเป็น nice-to-have — ไม่ให้กระทบ flow หลัก
  }
}
