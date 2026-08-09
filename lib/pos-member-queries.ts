import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { pointsFromNet } from "@/lib/pos-combo-pricing";

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
  cardTheme: string;
  /** แต้มที่ต้องมีก่อนจะกดแลกรางวัลได้ */
  redeemPoints: number;
  /** token เมนูสาธารณะของร้าน — ใช้พาลูกค้าจากบัตรไปหน้า app/สั่งอาหาร */
  publicMenuToken: string | null;
  events: PosPointEvent[];
} | null> {
  const { rows } = await pool.query<
    MemberRow & {
      user_id: string;
      shop_name: string;
      reward_note: string | null;
      baht_per_point: number;
      card_theme: string | null;
      redeem_points: number;
      public_menu_token: string | null;
    }
  >(
    `SELECT m.id, m.phone, m.name, m.points, m.total_spent::text, m.visit_count,
            m.last_visit_at, m.access_token, m.created_at,
            m.user_id, u.shop_name,
            s.reward_note, COALESCE(s.baht_per_point, 10) AS baht_per_point,
            s.card_theme, COALESCE(s.redeem_points, 100) AS redeem_points,
            s.public_menu_token
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
    cardTheme: r.card_theme ?? "ink",
    redeemPoints: r.redeem_points,
    publicMenuToken: r.public_menu_token ?? null,
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

type PointRules = {
  enabled: boolean;
  /** สูตรเดิม: ซื้อครบกี่บาทได้ 1 แต้ม */
  bahtPerPoint: number;
  /** สูตรใหม่ (0071): คืนกี่ % ของยอดสุทธิ */
  loyaltyReturnPct: number;
  pointValueSatang: number;
  usePct: boolean;
};

export async function getPointRules(
  userId: string,
  client?: PoolClient,
): Promise<PointRules> {
  const q = client ?? pool;
  const { rows } = await q.query<{
    points_enabled: boolean;
    baht_per_point: number;
    loyalty_return_pct: string | null;
    point_value_satang: number | null;
    loyalty_use_pct: boolean | null;
  }>(
    `SELECT points_enabled, baht_per_point,
            loyalty_return_pct::text AS loyalty_return_pct,
            point_value_satang, loyalty_use_pct
     FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    enabled: rows[0]?.points_enabled ?? false,
    bahtPerPoint: rows[0]?.baht_per_point ?? 10,
    loyaltyReturnPct: Number(rows[0]?.loyalty_return_pct ?? 8),
    pointValueSatang: Number(rows[0]?.point_value_satang ?? 10),
    usePct: rows[0]?.loyalty_use_pct ?? false,
  };
}

/**
 * แต้มที่ได้จากยอดสุทธิ 1 บิล — จุดเดียวที่ตัดสินใจว่าใช้สูตรไหน
 *
 * ⚠️ ต้องคำนวณฝั่งเซิร์ฟเวอร์เสมอ frontend ห้ามกำหนดเอง
 *
 * usePct = true  → คืน N% ของยอด แล้วแปลงเป็นแต้ม (0071 — ตอบได้ว่าจ่ายไปกี่ % จริง)
 * usePct = false → ซื้อครบ N บาท = 1 แต้ม (สูตรเดิม เก็บไว้เป็นทางถอยกลับ)
 */
export function calcEarnedPoints(totalAmount: string, rules: PointRules): number {
  if (!rules.enabled) return 0;
  if (rules.usePct) {
    return pointsFromNet(totalAmount, {
      loyaltyReturnPct: rules.loyaltyReturnPct,
      pointValueSatang: rules.pointValueSatang,
    });
  }
  if (rules.bahtPerPoint <= 0) return 0;
  return Math.floor(parseFloat(totalAmount) / rules.bahtPerPoint);
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
  const points = calcEarnedPoints(input.totalAmount, rules);
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

// --- แลกแต้มด้วย QR (0070) --------------------------------------------------

export class PosRedeemCodeInvalidError extends Error {
  constructor(public readonly kind: "not_found" | "used" | "expired") {
    super(kind);
  }
}

/** ตัวอักษรที่ไม่ชวนอ่านผิด: ตัด 0/O/1/I/L ออก — คนต้องพิมพ์โค้ดนี้ด้วยมือได้ */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 6;
const CODE_TTL_MS = 5 * 60 * 1000;

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export type PosRedeemCode = {
  code: string;
  points: number;
  rewardNote: string | null;
  expiresAt: string;
};

/**
 * ลูกค้ากด "แลกรางวัล" บนบัตร → ได้โค้ดใช้ครั้งเดียว อายุ 5 นาที
 *
 * ⚠️ ยังไม่ตัดแต้มที่ขั้นนี้ — แต้มหักตอน POS สแกนสำเร็จเท่านั้น
 *    (ถ้าตัดตอนสร้างโค้ด ลูกค้ากดเล่นแล้วไม่ไปแลก แต้มจะหายฟรี)
 *
 * โค้ดเก่าที่ยังไม่ใช้ของสมาชิกคนนี้ถูกทำให้หมดอายุทันที — กันมีหลายโค้ดลอยอยู่พร้อมกัน
 */
export async function createRedeemCode(
  userId: string,
  memberId: string,
): Promise<PosRedeemCode> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cfg } = await client.query<{
      redeem_points: number;
      reward_note: string | null;
      points_enabled: boolean;
    }>(
      `SELECT COALESCE(redeem_points, 100) AS redeem_points, reward_note, points_enabled
       FROM pos_shop_settings WHERE user_id = $1`,
      [userId],
    );
    if (!cfg[0]?.points_enabled) {
      await client.query("ROLLBACK");
      throw new Error("points_disabled");
    }
    const needed = cfg[0].redeem_points;

    const { rows: mem } = await client.query<{ points: number }>(
      `SELECT points FROM pos_members
       WHERE id = $2 AND user_id = $1 AND is_active = true
       FOR UPDATE`,
      [userId, memberId],
    );
    if (!mem[0]) {
      await client.query("ROLLBACK");
      throw new Error("member_not_found");
    }
    if (mem[0].points < needed) {
      const have = mem[0].points;
      await client.query("ROLLBACK");
      throw new PosNotEnoughPointsError(have);
    }

    // โค้ดเก่าที่ยังไม่ใช้ → ปิดทิ้ง (ให้เหลือใบเดียวที่ใช้ได้จริง)
    await client.query(
      `UPDATE pos_redeem_codes SET expires_at = now()
       WHERE member_id = $2 AND user_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [userId, memberId],
    );

    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    // ชนโค้ดซ้ำมีโอกาสน้อยมาก (31^6) แต่ retry ไว้กันเหนียว
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        await client.query(
          `INSERT INTO pos_redeem_codes
             (user_id, member_id, code, points, reward_note, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, memberId, code, needed, cfg[0].reward_note, expiresAt],
        );
        await client.query("COMMIT");
        return {
          code,
          points: needed,
          rewardNote: cfg[0].reward_note,
          expiresAt: expiresAt.toISOString(),
        };
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode !== "23505") throw err; // ไม่ใช่ unique violation → โยนต่อ
      }
    }
    await client.query("ROLLBACK");
    throw new Error("code_generation_failed");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POS สแกน/กรอกโค้ด → เผาโค้ด + ตัดแต้ม ใน transaction เดียว
 *
 * ⚠️ ไม่ลดยอดบิลและไม่แตะบัญชี — ของแถมส่งมือ (ดูหมายเหตุใน 0068)
 *    ถ้าวันหนึ่งจะให้แต้มเป็นส่วนลดเงินจริง ต้องออกแบบ journal ก่อน
 *    (ลดรายได้ vs ค่าใช้จ่ายการตลาด) เป็นการตัดสินใจทางบัญชี ไม่ใช่ทาง UI
 *
 * กันใช้ซ้ำด้วย FOR UPDATE + เช็ค used_at ในล็อกเดียวกัน — สแกนพร้อมกัน 2 เครื่อง
 * จะมีเครื่องเดียวที่ผ่าน
 */
export async function consumeRedeemCode(
  userId: string,
  rawCode: string,
): Promise<{ member: PosMember; points: number; rewardNote: string | null }> {
  const code = rawCode.trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: string;
      member_id: string;
      points: number;
      reward_note: string | null;
      used_at: Date | null;
      expired: boolean;
    }>(
      `SELECT id, member_id, points, reward_note, used_at, (expires_at <= now()) AS expired
       FROM pos_redeem_codes
       WHERE user_id = $1 AND code = $2
       FOR UPDATE`,
      [userId, code],
    );
    const row = rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      throw new PosRedeemCodeInvalidError("not_found");
    }
    if (row.used_at) {
      await client.query("ROLLBACK");
      throw new PosRedeemCodeInvalidError("used");
    }
    if (row.expired) {
      await client.query("ROLLBACK");
      throw new PosRedeemCodeInvalidError("expired");
    }

    const { rows: mem } = await client.query<{ points: number }>(
      `SELECT points FROM pos_members
       WHERE id = $2 AND user_id = $1 AND is_active = true
       FOR UPDATE`,
      [userId, row.member_id],
    );
    if (!mem[0]) {
      await client.query("ROLLBACK");
      throw new Error("member_not_found");
    }
    if (mem[0].points < row.points) {
      const have = mem[0].points;
      await client.query("ROLLBACK");
      throw new PosNotEnoughPointsError(have);
    }

    await client.query(`UPDATE pos_redeem_codes SET used_at = now() WHERE id = $1`, [row.id]);
    await client.query(
      `INSERT INTO pos_point_events (user_id, member_id, delta, reason, note)
       VALUES ($1, $2, $3, 'redeem', $4)`,
      [userId, row.member_id, -row.points, row.reward_note?.slice(0, 200) ?? `โค้ด ${code}`],
    );
    const { rows: updated } = await client.query<MemberRow>(
      `UPDATE pos_members SET points = points - $3, updated_at = now()
       WHERE id = $2 AND user_id = $1
       RETURNING ${MEMBER_RETURN}`,
      [userId, row.member_id, row.points],
    );

    await client.query("COMMIT");
    return {
      member: mapMember(updated[0]),
      points: row.points,
      rewardNote: row.reward_note,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
