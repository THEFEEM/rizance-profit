import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

/**
 * ระบบสมาชิก + แต้ม (migration 0068)
 *
 * ⚠️ ข้อตกลงสำคัญ: **แต้มไม่ใช่เงิน**
 * ทุกฟังก์ชันในไฟล์นี้แตะแค่ pos_members / pos_point_events / pos_bills.member_id
 * ไม่มีอะไรเขียน income_entries, journal_entries, หรือ pos_bills.total_amount
 * → invariant SUM(bill_items.line_total) = bills.total_amount = debit = credit ไม่ถูกกระทบ
 *
 * points เป็นยอดแคช ledger จริงคือ pos_point_events — อัปเดตพร้อมกันใน transaction เดียวเสมอ
 */

export type PosMember = {
  id: string;
  phone: string;
  name: string | null;
  points: number;
  totalSpent: string;
  visitCount: number;
  lastVisitAt: string | null;
  accessToken: string;
  createdAt: string;
};

export type PosPointEvent = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  billNo: string | null;
  createdAt: string;
};

type MemberRow = {
  id: string;
  phone: string;
  name: string | null;
  points: number;
  total_spent: string;
  visit_count: number;
  last_visit_at: Date | null;
  access_token: string;
  created_at: Date;
};

const MEMBER_RETURN = `id, phone, name, points, total_spent::text, visit_count,
  last_visit_at, access_token, created_at`;

function mapMember(r: MemberRow): PosMember {
  return {
    id: r.id,
    phone: r.phone,
    name: r.name,
    points: r.points,
    totalSpent: r.total_spent,
    visitCount: r.visit_count,
    lastVisitAt: r.last_visit_at ? r.last_visit_at.toISOString() : null,
    accessToken: r.access_token,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * เบอร์โทรไทยให้เหลือแต่ตัวเลข — "081-234 5678" และ "0812345678" ต้องเป็นคนเดียวกัน
 * ไม่งั้น unique(user_id, phone) กันซ้ำไม่ได้จริง
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // +66812345678 / 66812345678 → 0812345678
  if (digits.length === 11 && digits.startsWith("66")) return `0${digits.slice(2)}`;
  return digits;
}

export function isValidThaiPhone(raw: string): boolean {
  const p = normalizePhone(raw);
  return /^0\d{8,9}$/.test(p);
}

export class PosInvalidPhoneError extends Error {
  constructor() {
    super("invalid_phone");
  }
}

export class PosNotEnoughPointsError extends Error {
  constructor(public readonly points: number) {
    super("not_enough_points");
  }
}

/** สร้างสมาชิกใหม่ถ้าเบอร์นี้ยังไม่มี — idempotent ปลอดภัยเมื่อกดซ้ำ */
export async function upsertPosMember(
  userId: string,
  input: { phone: string; name?: string | null },
  client?: PoolClient,
): Promise<PosMember> {
  const phone = normalizePhone(input.phone);
  if (!isValidThaiPhone(phone)) throw new PosInvalidPhoneError();
  const q = client ?? pool;
  const name = input.name?.trim() || null;

  const { rows } = await q.query<MemberRow>(
    `INSERT INTO pos_members (user_id, phone, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, phone) DO UPDATE
       SET name = COALESCE(NULLIF(EXCLUDED.name, ''), pos_members.name),
           updated_at = now()
     RETURNING ${MEMBER_RETURN}`,
    [userId, phone, name],
  );
  return mapMember(rows[0]);
}

export async function findPosMemberByPhone(
  userId: string,
  phone: string,
): Promise<PosMember | null> {
  const p = normalizePhone(phone);
  if (!p) return null;
  const { rows } = await pool.query<MemberRow>(
    `SELECT ${MEMBER_RETURN} FROM pos_members WHERE user_id = $1 AND phone = $2`,
    [userId, p],
  );
  return rows[0] ? mapMember(rows[0]) : null;
}

/** บัตรสมาชิกฝั่งลูกค้า — เข้าด้วย token เท่านั้น ไม่มี session */
export async function getPosMemberByToken(token: string): Promise<{
  member: PosMember;
  userId: string;
  shopName: string;
  rewardNote: string | null;
  bahtPerPoint: number;
  events: PosPointEvent[];
} | null> {
  const { rows } = await pool.query<
    MemberRow & {
      user_id: string;
      shop_name: string;
      reward_note: string | null;
      baht_per_point: number;
    }
  >(
    `SELECT m.id, m.phone, m.name, m.points, m.total_spent::text, m.visit_count,
            m.last_visit_at, m.access_token, m.created_at,
            m.user_id, u.shop_name,
            s.reward_note, COALESCE(s.baht_per_point, 10) AS baht_per_point
     FROM pos_members m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN pos_shop_settings s ON s.user_id = m.user_id
     WHERE m.access_token = $1 AND m.is_active = true`,
    [token],
  );
  if (!rows[0]) return null;
  const r = rows[0];

  const { rows: eventRows } = await pool.query<{
    id: string;
    delta: number;
    reason: string;
    note: string | null;
    bill_no: string | null;
    created_at: Date;
  }>(
    `SELECT e.id, e.delta, e.reason, e.note, b.bill_no, e.created_at
     FROM pos_point_events e
     LEFT JOIN pos_bills b ON b.id = e.bill_id
     WHERE e.member_id = $1
     ORDER BY e.created_at DESC
     LIMIT 30`,
    [r.id],
  );

  return {
    member: mapMember(r),
    userId: r.user_id,
    shopName: r.shop_name,
    rewardNote: r.reward_note,
    bahtPerPoint: r.baht_per_point,
    events: eventRows.map((e) => ({
      id: e.id,
      delta: e.delta,
      reason: e.reason,
      note: e.note,
      billNo: e.bill_no,
      createdAt: e.created_at.toISOString(),
    })),
  };
}

/** อันดับลูกค้าประจำฝั่งร้าน */
export async function listPosMembers(
  userId: string,
  limit = 50,
): Promise<PosMember[]> {
  const { rows } = await pool.query<MemberRow>(
    `SELECT ${MEMBER_RETURN}
     FROM pos_members
     WHERE user_id = $1 AND is_active = true
     ORDER BY total_spent DESC, visit_count DESC, created_at DESC
     LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(mapMember);
}

type PointRules = { enabled: boolean; bahtPerPoint: number };

export async function getPointRules(
  userId: string,
  client?: PoolClient,
): Promise<PointRules> {
  const q = client ?? pool;
  const { rows } = await q.query<{ points_enabled: boolean; baht_per_point: number }>(
    `SELECT points_enabled, baht_per_point FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    enabled: rows[0]?.points_enabled ?? false,
    bahtPerPoint: rows[0]?.baht_per_point ?? 10,
  };
}

/**
 * ให้แต้มจากบิลที่ปิดแล้ว — เรียกจาก closePosBill ใน transaction เดียวกับบิล
 *
 * ปัดลง (floor) เสมอ: ซื้อ 69 บาท กติกา 10 บาท/แต้ม = 6 แต้ม ไม่ใช่ 6.9
 * ยอด 0 แต้ม (ซื้อน้อยกว่า 1 แต้ม) ไม่ INSERT event เลย — CHECK delta <> 0 กันอยู่
 *
 * ⚠️ กันนับซ้ำด้วย pos_bills.member_id IS NULL เป็นประตูเดียว
 *    ถ้าใครเรียกฟังก์ชันนี้สองครั้งกับบิลเดิม รอบสองจะได้ rowCount 0 แล้วออกทันที
 *    (ใช้ event เป็นตัวกันไม่ได้ เพราะบิลยอดน้อยกว่า 1 แต้มไม่มี event)
 */
export async function earnPointsForBill(
  client: PoolClient,
  userId: string,
  input: { memberId: string; billId: string; totalAmount: string },
): Promise<number> {
  // ผูกบิลกับสมาชิกก่อน แม้ยอดยังไม่ถึง 1 แต้ม — ต้องรู้ว่าใครซื้อ
  const { rowCount } = await client.query(
    `UPDATE pos_bills SET member_id = $3
     WHERE id = $2 AND user_id = $1 AND member_id IS NULL`,
    [userId, input.billId, input.memberId],
  );
  if (!rowCount) return 0; // บิลนี้ผูกสมาชิกไปแล้ว → เคยให้แต้มแล้ว

  await client.query(
    `UPDATE pos_members
     SET total_spent = total_spent + $3::numeric,
         visit_count = visit_count + 1,
         last_visit_at = now(),
         updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, input.memberId, input.totalAmount],
  );

  const rules = await getPointRules(userId, client);
  if (!rules.enabled) return 0;
  const points = Math.floor(parseFloat(input.totalAmount) / rules.bahtPerPoint);
  if (points <= 0) return 0;

  await client.query(
    `INSERT INTO pos_point_events (user_id, member_id, bill_id, delta, reason)
     VALUES ($1, $2, $3, $4, 'earn')`,
    [userId, input.memberId, input.billId, points],
  );
  await client.query(
    `UPDATE pos_members SET points = points + $3, updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, input.memberId, points],
  );
  return points;
}

/**
 * ยกเลิกบิล → ถอนแต้มคืน (เรียกจาก voidPosBill ใน transaction เดียวกัน)
 *
 * ไม่ลบ event เดิม — ใส่ event ติดลบ ให้ ledger ตรวจย้อนหลังได้
 * GREATEST(points - x, 0) กัน CHECK points >= 0 พังกรณีแต้มถูกใช้ไปแล้ว
 *
 * ⚠️ กันถอนซ้ำด้วย INSERT ... RETURNING: unique (bill_id, reason) ทำให้ void_reverse
 *    ของบิลเดิมเข้าได้ครั้งเดียว ถ้าไม่ได้ row กลับมาก็ไม่หักยอดใดๆ
 */
export async function reversePointsForBill(
  client: PoolClient,
  userId: string,
  billId: string,
): Promise<void> {
  const { rows: billRows } = await client.query<{
    member_id: string | null;
    total_amount: string;
  }>(
    `SELECT member_id, total_amount::text FROM pos_bills WHERE id = $2 AND user_id = $1`,
    [userId, billId],
  );
  const memberId = billRows[0]?.member_id ?? null;
  if (!memberId) return;

  const { rows: earnRows } = await client.query<{ earned: number }>(
    `SELECT COALESCE(SUM(delta), 0)::int AS earned
     FROM pos_point_events
     WHERE user_id = $1 AND bill_id = $2 AND reason = 'earn'`,
    [userId, billId],
  );
  const earned = earnRows[0]?.earned ?? 0;

  if (earned > 0) {
    const { rowCount } = await client.query(
      `INSERT INTO pos_point_events (user_id, member_id, bill_id, delta, reason, note)
       VALUES ($1, $2, $3, $4, 'void_reverse', 'ยกเลิกบิล')
       ON CONFLICT (bill_id, reason) DO NOTHING`,
      [userId, memberId, billId, -earned],
    );
    if (!rowCount) return; // ถอนคืนไปแล้ว — อย่าหักยอดสะสมซ้ำ
    await client.query(
      `UPDATE pos_members SET points = GREATEST(points - $3, 0), updated_at = now()
       WHERE id = $2 AND user_id = $1`,
      [userId, memberId, earned],
    );
  }

  // ยอดสะสม/จำนวนครั้งถอยด้วย — ทำหลังประตูกันซ้ำด้านบน
  await client.query(
    `UPDATE pos_members
     SET total_spent = GREATEST(total_spent - $3::numeric, 0),
         visit_count = GREATEST(visit_count - 1, 0),
         updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, memberId, billRows[0].total_amount],
  );
}

/**
 * ตัดแต้มเมื่อลูกค้าแลกของ (พนักงานกดหน้าร้าน)
 *
 * ⚠️ ไม่ลดยอดบิลและไม่แตะบัญชี — ของแถมส่งมือ
 * ถ้าวันหนึ่งจะให้แต้มเป็นส่วนลดเงินจริง ต้องออกแบบ journal ก่อน
 * (ลดรายได้ vs ค่าใช้จ่ายการตลาด) เป็นการตัดสินใจทางบัญชี ไม่ใช่ทาง UI
 */
export async function redeemPoints(
  userId: string,
  memberId: string,
  points: number,
  note?: string,
): Promise<PosMember> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ points: number }>(
      `SELECT points FROM pos_members
       WHERE id = $2 AND user_id = $1 AND is_active = true
       FOR UPDATE`,
      [userId, memberId],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      throw new Error("member_not_found");
    }
    if (rows[0].points < points) {
      const have = rows[0].points;
      await client.query("ROLLBACK");
      throw new PosNotEnoughPointsError(have);
    }

    await client.query(
      `INSERT INTO pos_point_events (user_id, member_id, delta, reason, note)
       VALUES ($1, $2, $3, 'redeem', $4)`,
      [userId, memberId, -points, note?.slice(0, 200) ?? null],
    );
    const { rows: updated } = await client.query<MemberRow>(
      `UPDATE pos_members SET points = points - $3, updated_at = now()
       WHERE id = $2 AND user_id = $1
       RETURNING ${MEMBER_RETURN}`,
      [userId, memberId, points],
    );
    await client.query("COMMIT");
    return mapMember(updated[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
