import { pool } from "@/lib/db";

/**
 * ความเห็นลูกค้าหลังรับอาหาร (QR).
 * เขียนได้ผ่าน access_token ของออเดอร์เท่านั้น — 1 ออเดอร์ = 1 ครั้ง (UNIQUE order_id)
 * ให้เขียนได้เมื่อสถานะ ready/completed (ของถึงมือลูกค้าแล้ว)
 */

export class FeedbackOrderNotFoundError extends Error {
  constructor() {
    super("order not found for feedback");
    this.name = "FeedbackOrderNotFoundError";
  }
}

export class FeedbackNotAllowedYetError extends Error {
  constructor() {
    super("order not ready for feedback");
    this.name = "FeedbackNotAllowedYetError";
  }
}

export class FeedbackAlreadyExistsError extends Error {
  constructor() {
    super("feedback already submitted");
    this.name = "FeedbackAlreadyExistsError";
  }
}

const ALLOWED_STATUSES = new Set(["ready", "completed"]);

export async function submitOrderFeedback(
  accessToken: string,
  input: { rating: number; comment?: string },
): Promise<{ orderNo: string; rating: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: string;
      user_id: string;
      order_no: string;
      status: string;
    }>(
      `SELECT id, user_id, order_no, status FROM pos_orders
       WHERE access_token = $1
       FOR UPDATE`,
      [accessToken],
    );
    const order = rows[0];
    if (!order) throw new FeedbackOrderNotFoundError();
    if (!ALLOWED_STATUSES.has(order.status)) throw new FeedbackNotAllowedYetError();

    const { rowCount } = await client.query(
      `INSERT INTO pos_order_feedback (user_id, order_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (order_id) DO NOTHING`,
      [order.user_id, order.id, input.rating, input.comment?.trim() || null],
    );
    if ((rowCount ?? 0) === 0) throw new FeedbackAlreadyExistsError();

    await client.query("COMMIT");
    return { orderNo: order.order_no, rating: input.rating };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type PosFeedbackItem = {
  id: string;
  orderNo: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export type PosFeedbackSummary = {
  count: number;
  /** ค่าเฉลี่ยดาว 1 ตำแหน่ง เช่น "4.6" — null เมื่อยังไม่มีรีวิว */
  average: string | null;
  /** จำนวนต่อดาว index 0 = 1 ดาว */
  distribution: number[];
  recent: PosFeedbackItem[];
};

export async function getPosFeedback(
  userId: string,
  limit = 20,
): Promise<PosFeedbackSummary> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const [{ rows: stats }, { rows: recent }] = await Promise.all([
    pool.query<{ rating: number; c: string }>(
      `SELECT rating, COUNT(*)::text AS c
       FROM pos_order_feedback
       WHERE user_id = $1
       GROUP BY rating`,
      [userId],
    ),
    pool.query<{
      id: string;
      order_no: string;
      rating: number;
      comment: string | null;
      created_at: Date | string;
    }>(
      `SELECT f.id, o.order_no, f.rating, f.comment, f.created_at
       FROM pos_order_feedback f
       JOIN pos_orders o ON o.id = f.order_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [userId, safeLimit],
    ),
  ]);

  const distribution = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of stats) {
    const n = parseInt(row.c, 10);
    distribution[row.rating - 1] = n;
    count += n;
    sum += row.rating * n;
  }

  return {
    count,
    average: count > 0 ? (sum / count).toFixed(1) : null,
    distribution,
    recent: recent.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  };
}
