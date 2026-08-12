import type { PoolClient } from "pg";
import { pool } from "./db";
import { getDayCutoffHour } from "./pos-settings-queries";
import { normalizePhone, isValidThaiPhone } from "./pos-member-queries";

/**
 * NINENON Feedback Center (0073)
 *
 * ═══ กฎที่ไฟล์นี้บังคับ ═══════════════════════════════════════
 *
 * 1) แต้มโบนัสได้เมื่อ "เบอร์ที่กรอกมีบิล paid ในวันขายเดียวกัน" เท่านั้น
 *    QR แขวนหน้าร้าน = ใครก็สแกนได้ ถ้าให้แต้มทุกครั้งคือแจกฟรี
 *
 * 2) กันฟาร์มด้วย unique index ของ DB ไม่ใช่ if ใน code
 *    ยิงพร้อมกัน 10 request → DB ให้ผ่านใบเดียว ที่เหลือได้ 0 แต้มแต่ feedback ยังบันทึก
 *
 * 3) ไม่กรอกเบอร์ = บันทึกได้ปกติ แค่ไม่ได้แต้ม (ห้ามบังคับเบอร์)
 *
 * ⚠️ ไม่แตะเงินเลย: ไม่มี journal / income_entries / pos_bills.total_amount
 *    invariant Σ line_total = total_amount = debit = credit ยังจริงทุกบิล
 *
 * ⚠️ ของเก่า: pos_order_feedback (0056) ถูกย้ายเข้า pos_feedback ใน migration 0073
 *    ฟังก์ชัน submitOrderFeedback / getPosFeedback ยังชื่อเดิม signature เดิม
 *    (dashboard + หน้าติดตามออเดอร์เรียกใช้อยู่) แต่อ่าน/เขียนตารางใหม่แล้ว
 *    → เสียงลูกค้ามีแหล่งเดียว คะแนนเฉลี่ยไม่มีทางขัดกันเอง
 */

export const FEEDBACK_KINDS = ["food", "shop", "menu_idea", "issue", "praise"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ["new", "seen", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** ชื่อคอลัมน์คะแนน — ใช้ร่วมกันทั้ง insert และ summary กันพิมพ์ผิดคนละที่ */
const RATING_COLUMNS = [
  "overall",
  "taste",
  "portion",
  "value",
  "service",
  "clean",
  "speed",
] as const;
export type RatingKey = (typeof RATING_COLUMNS)[number];
export type Ratings = Partial<Record<RatingKey, number | null>>;

export type FeedbackItemInput = {
  productId: string | null;
  productName: string;
  rating: number;
  comment?: string | null;
};

export type CreateFeedbackInput = {
  kind: FeedbackKind;
  topic?: string | null;
  ratings: Ratings;
  comment?: string | null;
  phone?: string | null;
  /** ออเดอร์ที่โยงมา (มาจากหน้าติดตามออเดอร์) — ตรวจสิทธิ์ที่ route ก่อนเรียก */
  orderId?: string | null;
  billId?: string | null;
  items?: FeedbackItemInput[];
};

export type CreateFeedbackResult = {
  id: string;
  pointsAwarded: number;
  /** เหตุผลที่ไม่ได้แต้ม — เอาไปบอกลูกค้าตรง ๆ ไม่ปล่อยให้เดา */
  pointsBlockedReason:
    | null
    | "no_phone"
    | "invalid_phone"
    | "no_member"
    | "no_bill_today"
    | "already_awarded_today"
    | "disabled";
  memberToken: string | null;
  pointsBalance: number | null;
};

export class PosFeedbackDisabledError extends Error {
  constructor() {
    super("feedback_disabled");
    this.name = "PosFeedbackDisabledError";
  }
}

/** คะแนนต้อง 1–5 จำนวนเต็ม ไม่งั้นทิ้ง (ไม่ throw — client เพี้ยนไม่ควรทำให้เสียงลูกค้าหาย) */
function cleanRating(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** วันขายวันนี้ของร้าน (คิด day_cutoff_hour แล้ว) เป็นสตริง YYYY-MM-DD เวลาไทย */
async function businessDateToday(
  userId: string,
  client?: { query: typeof pool.query },
): Promise<string> {
  const cutoff = await getDayCutoffHour(userId, client);
  const q = client ?? pool;
  // ให้ Postgres คิดทั้งหมด — ห้ามคิดใน Node เพราะ TZ ของ Vercel เป็น UTC
  const { rows } = await q.query<{ d: string }>(
    `SELECT ((now() AT TIME ZONE 'Asia/Bangkok') - make_interval(hours => $1::int))::date::text AS d`,
    [cutoff],
  );
  return rows[0].d;
}

type FeedbackSettings = { enabled: boolean; points: number };

async function getFeedbackSettings(
  userId: string,
  client?: { query: typeof pool.query },
): Promise<FeedbackSettings> {
  const q = client ?? pool;
  const { rows } = await q.query<{ feedback_enabled: boolean; feedback_points: number }>(
    `SELECT feedback_enabled, feedback_points FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    enabled: rows[0]?.feedback_enabled ?? true,
    points: Number(rows[0]?.feedback_points ?? 0),
  };
}

/**
 * ลูกค้าส่ง feedback (public — ไม่มี session)
 *
 * ลำดับที่ต้องรักษาไว้:
 *   1) ตรวจสิทธิ์แต้มก่อน (นอก transaction ได้ เพราะเป็นแค่การอ่าน)
 *   2) เขียน feedback + items + แต้ม ใน transaction เดียว
 *   3) ถ้าโดน unique index กันฟาร์ม → เขียนใหม่แบบ 0 แต้ม (feedback ต้องไม่หาย)
 */
export async function createPublicFeedback(
  userId: string,
  input: CreateFeedbackInput,
): Promise<CreateFeedbackResult> {
  const settings = await getFeedbackSettings(userId);
  if (!settings.enabled) throw new PosFeedbackDisabledError();

  const businessDate = await businessDateToday(userId);

  // ── หาว่ามีสิทธิ์รับแต้มไหม ────────────────────────────────
  let memberId: string | null = null;
  let memberToken: string | null = null;
  let phone: string | null = null;
  let blocked: CreateFeedbackResult["pointsBlockedReason"] = null;

  const rawPhone = cleanText(input.phone, 30);
  if (!rawPhone) {
    blocked = "no_phone";
  } else if (!isValidThaiPhone(rawPhone)) {
    blocked = "invalid_phone";
    phone = normalizePhone(rawPhone).slice(0, 20) || null;
  } else {
    phone = normalizePhone(rawPhone);
    const { rows } = await pool.query<{ id: string; access_token: string }>(
      `SELECT id, access_token FROM pos_members
       WHERE user_id = $1 AND phone = $2 AND is_active = true`,
      [userId, phone],
    );
    if (!rows[0]) {
      // ไม่สร้างสมาชิกใหม่จาก feedback โดยเจตนา — ไม่งั้นได้ฐานสมาชิกขยะ
      // ที่ไม่เคยซื้ออะไร แล้วรายงาน "จำนวนสมาชิก" กลายเป็นตัวเลขหลอกตัวเอง
      blocked = "no_member";
    } else {
      memberId = rows[0].id;
      memberToken = rows[0].access_token;
      const { rows: billRows } = await pool.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pos_bills
           WHERE user_id = $1 AND member_id = $2
             AND status = 'paid' AND entry_date = $3::date
         ) AS ok`,
        [userId, memberId, businessDate],
      );
      if (!billRows[0]?.ok) blocked = "no_bill_today";
    }
  }

  if (settings.points <= 0 && !blocked) blocked = "disabled";
  const wantPoints = blocked === null && memberId !== null;

  // ── เขียน ───────────────────────────────────────────────────
  const attempt = async (withPoints: boolean) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const points = withPoints ? settings.points : 0;
      const id = await insertFeedback(client, userId, {
        input,
        memberId,
        phone,
        businessDate,
        points,
      });
      if (points > 0 && memberId) {
        await client.query(
          `INSERT INTO pos_point_events (user_id, member_id, bill_id, delta, reason, note)
           VALUES ($1, $2, NULL, $3, 'feedback', $4)`,
          [userId, memberId, points, `feedback:${input.kind}`],
        );
        await client.query(
          `UPDATE pos_members SET points = points + $3, updated_at = now()
           WHERE id = $2 AND user_id = $1`,
          [userId, memberId, points],
        );
      }
      await client.query("COMMIT");
      return { id, points };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  let written: { id: string; points: number };
  try {
    written = await attempt(wantPoints);
  } catch (err) {
    // 23505 = unique_violation → วันนี้เบอร์นี้รับแต้มไปแล้ว
    // (index กันฟาร์มทำงาน) · feedback ยังต้องถูกบันทึก จึงเขียนใหม่แบบ 0 แต้ม
    if (wantPoints && isAwardConflict(err)) {
      blocked = "already_awarded_today";
      written = await attempt(false);
    } else {
      throw err;
    }
  }

  let pointsBalance: number | null = null;
  if (memberId) {
    const { rows } = await pool.query<{ points: number }>(
      `SELECT points FROM pos_members WHERE id = $1`,
      [memberId],
    );
    pointsBalance = Number(rows[0]?.points ?? 0);
  }

  return {
    id: written.id,
    pointsAwarded: written.points,
    pointsBlockedReason: written.points > 0 ? null : (blocked ?? "no_phone"),
    memberToken,
    pointsBalance,
  };
}

/**
 * ชนกับ index กันฟาร์มแต้ม (idx_pos_feedback_award_once_per_day) หรือเปล่า
 *
 * ⚠️ ต้องเช็คชื่อ constraint ด้วย ไม่ใช่แค่ code 23505:
 *    ถ้าเช็คแค่ code แล้ววันหน้ามี unique index อื่นเพิ่มเข้ามา
 *    การชนอันนั้นจะถูกกลืนเป็น "วันนี้รับแต้มไปแล้ว" แบบเงียบ ๆ หา bug ไม่เจอ
 */
function isAwardConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === "idx_pos_feedback_award_once_per_day";
}

async function insertFeedback(
  client: PoolClient,
  userId: string,
  args: {
    input: CreateFeedbackInput;
    memberId: string | null;
    phone: string | null;
    businessDate: string;
    points: number;
    /** 'quick' = ปุ่มดาวบนหน้าออเดอร์ (จำกัด 1/ออเดอร์) · 'center' = Feedback Center */
    source?: "quick" | "center";
  },
): Promise<string> {
  const { input, memberId, phone, businessDate, points } = args;
  const r = { ...(input.ratings ?? {}) };

  /**
   * ⚠️ กรณีที่ทำให้ 500 มาแล้ว: ลูกค้าให้คะแนน "รายเมนู" อย่างเดียว
   *    ไม่แตะคะแนนด้านบนและไม่พิมพ์ข้อความ → แถวแม่ว่างเปล่า
   *    → ชน CHECK pos_feedback_not_empty แล้วหน้าเว็บขึ้น "ส่งไม่สำเร็จ"
   *
   * แก้ด้วยการสรุป overall จากค่าเฉลี่ยของเมนูที่ให้คะแนน — ถูกทั้งทางเทคนิคและทางความหมาย:
   * "ให้ 4,3,3,4 ราย ๆ จาน" = ความรู้สึกรวมประมาณ 4 · dashboard จึงนับ feedback ใบนี้ด้วย
   * (ถ้าปล่อยว่าง ใบนี้จะหายจากคะแนนเฉลี่ยทั้งที่ลูกค้าตอบมาแล้ว)
   */
  const parentRatings = [
    r.overall, r.taste, r.portion, r.value, r.service, r.clean, r.speed,
  ].map(cleanRating);
  const itemScores = (input.items ?? [])
    .map((i) => cleanRating(i.rating))
    .filter((n): n is number => n !== null);
  const hasParentRating = parentRatings.some((n) => n !== null);
  if (!hasParentRating && itemScores.length > 0) {
    r.overall = Math.round(itemScores.reduce((a, b) => a + b, 0) / itemScores.length);
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO pos_feedback (
       user_id, member_id, order_id, bill_id, kind, topic,
       rating_overall, rating_taste, rating_portion, rating_value,
       rating_service, rating_clean, rating_speed,
       comment, contact_phone, business_date, points_awarded
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17)
     RETURNING id`,
    [
      userId,
      memberId,
      input.orderId ?? null,
      input.billId ?? null,
      input.kind,
      cleanText(input.topic, 30),
      cleanRating(r.overall),
      cleanRating(r.taste),
      cleanRating(r.portion),
      cleanRating(r.value),
      cleanRating(r.service),
      cleanRating(r.clean),
      cleanRating(r.speed),
      cleanText(input.comment, 2000),
      phone,
      businessDate,
      points,
      args.source ?? "center",
    ],
  );
  const feedbackId = rows[0].id;

  for (const item of input.items ?? []) {
    const rating = cleanRating(item.rating);
    const name = cleanText(item.productName, 160);
    if (!rating || !name) continue;
    await client.query(
      `INSERT INTO pos_feedback_items (feedback_id, product_id, product_name, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [feedbackId, item.productId ?? null, name, rating, cleanText(item.comment, 300)],
    );
  }
  return feedbackId;
}

// ═══ ฝั่งร้าน ════════════════════════════════════════════════

export type PosFeedbackRow = {
  id: string;
  kind: FeedbackKind;
  topic: string | null;
  ratings: Record<RatingKey, number | null>;
  comment: string | null;
  contactPhone: string | null;
  memberName: string | null;
  orderNo: string | null;
  businessDate: string;
  pointsAwarded: number;
  status: FeedbackStatus;
  staffNote: string | null;
  createdAt: string;
  items: { productName: string; rating: number; comment: string | null }[];
};

export async function listPosFeedback(
  userId: string,
  opts: { from?: string; to?: string; kind?: FeedbackKind; status?: FeedbackStatus; limit?: number } = {},
): Promise<PosFeedbackRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const { rows } = await pool.query<{
    id: string;
    kind: FeedbackKind;
    topic: string | null;
    rating_overall: number | null;
    rating_taste: number | null;
    rating_portion: number | null;
    rating_value: number | null;
    rating_service: number | null;
    rating_clean: number | null;
    rating_speed: number | null;
    comment: string | null;
    contact_phone: string | null;
    member_name: string | null;
    order_no: string | null;
    business_date: string;
    points_awarded: number;
    status: FeedbackStatus;
    staff_note: string | null;
    created_at: string;
    items: { productName: string; rating: number; comment: string | null }[] | null;
  }>(
    `SELECT f.id, f.kind, f.topic,
            f.rating_overall, f.rating_taste, f.rating_portion, f.rating_value,
            f.rating_service, f.rating_clean, f.rating_speed,
            f.comment, f.contact_phone, m.name AS member_name, o.order_no,
            f.business_date::text AS business_date, f.points_awarded,
            f.status, f.staff_note, f.created_at,
            (SELECT json_agg(json_build_object(
                      'productName', i.product_name,
                      'rating', i.rating,
                      'comment', i.comment) ORDER BY i.rating ASC)
             FROM pos_feedback_items i WHERE i.feedback_id = f.id) AS items
     FROM pos_feedback f
     LEFT JOIN pos_members m ON m.id = f.member_id
     LEFT JOIN pos_orders  o ON o.id = f.order_id
     WHERE f.user_id = $1
       AND ($2::date IS NULL OR f.business_date >= $2::date)
       AND ($3::date IS NULL OR f.business_date <= $3::date)
       AND ($4::text IS NULL OR f.kind = $4)
       AND ($5::text IS NULL OR f.status = $5)
     ORDER BY f.created_at DESC
     LIMIT $6`,
    [userId, opts.from ?? null, opts.to ?? null, opts.kind ?? null, opts.status ?? null, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    topic: r.topic,
    ratings: {
      overall: r.rating_overall,
      taste: r.rating_taste,
      portion: r.rating_portion,
      value: r.rating_value,
      service: r.rating_service,
      clean: r.rating_clean,
      speed: r.rating_speed,
    },
    comment: r.comment,
    contactPhone: r.contact_phone,
    memberName: r.member_name,
    orderNo: r.order_no,
    businessDate: r.business_date,
    pointsAwarded: Number(r.points_awarded),
    status: r.status,
    staffNote: r.staff_note,
    createdAt: r.created_at,
    items: r.items ?? [],
  }));
}

export type PosFeedbackReport = {
  total: number;
  newCount: number;
  /** คะแนนเฉลี่ยแยกมิติ — null = ยังไม่มีใครให้คะแนนข้อนั้น (ไม่ใช่ 0) */
  averages: Record<RatingKey, { avg: number; count: number } | null>;
  /** ค่าเฉลี่ยรวมทุกมิติทุกใบ = ตัวเลขที่เอาไปโชว์ "4.7/5" */
  overallAvg: number | null;
  byKind: { kind: FeedbackKind; count: number }[];
  /** เมนูที่ลูกค้าขอ — เอา comment ของ kind='menu_idea' มาเรียงใหม่สุดก่อน */
  menuIdeas: { comment: string; createdAt: string }[];
  /** เมนูที่ได้คะแนนต่ำ (≤3) เรียงจากแย่สุด — จุดที่แก้แล้วเห็นผลเร็วที่สุด */
  weakProducts: { productName: string; avg: number; count: number }[];
  openIssues: number;
};

export async function getPosFeedbackReport(
  userId: string,
  opts: { from?: string; to?: string } = {},
): Promise<PosFeedbackReport> {
  const params = [userId, opts.from ?? null, opts.to ?? null];
  const dateFilter = `AND ($2::date IS NULL OR business_date >= $2::date)
                      AND ($3::date IS NULL OR business_date <= $3::date)`;

  const avgSelects = RATING_COLUMNS.map(
    (k) => `AVG(rating_${k})::float AS avg_${k}, COUNT(rating_${k})::int AS cnt_${k}`,
  ).join(", ");

  const { rows: aggRows } = await pool.query<Record<string, number | null>>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'new')::int AS new_count,
            COUNT(*) FILTER (WHERE kind = 'issue' AND status <> 'resolved')::int AS open_issues,
            ${avgSelects}
     FROM pos_feedback WHERE user_id = $1 ${dateFilter}`,
    params,
  );
  const agg = aggRows[0] ?? {};

  const averages = {} as PosFeedbackReport["averages"];
  let weightedSum = 0;
  let weightedCount = 0;
  for (const k of RATING_COLUMNS) {
    const count = Number(agg[`cnt_${k}`] ?? 0);
    const avg = agg[`avg_${k}`];
    if (count > 0 && avg !== null && avg !== undefined) {
      averages[k] = { avg: Math.round(Number(avg) * 100) / 100, count };
      weightedSum += Number(avg) * count;
      weightedCount += count;
    } else {
      averages[k] = null;
    }
  }

  const { rows: kindRows } = await pool.query<{ kind: FeedbackKind; count: number }>(
    `SELECT kind, COUNT(*)::int AS count FROM pos_feedback
     WHERE user_id = $1 ${dateFilter} GROUP BY kind ORDER BY count DESC`,
    params,
  );

  const { rows: ideaRows } = await pool.query<{ comment: string; created_at: string }>(
    `SELECT comment, created_at FROM pos_feedback
     WHERE user_id = $1 AND kind = 'menu_idea' AND comment IS NOT NULL ${dateFilter}
     ORDER BY created_at DESC LIMIT 30`,
    params,
  );

  const { rows: weakRows } = await pool.query<{
    product_name: string;
    avg: number;
    count: number;
  }>(
    `SELECT i.product_name, AVG(i.rating)::float AS avg, COUNT(*)::int AS count
     FROM pos_feedback_items i
     JOIN pos_feedback f ON f.id = i.feedback_id
     WHERE f.user_id = $1
       AND ($2::date IS NULL OR f.business_date >= $2::date)
       AND ($3::date IS NULL OR f.business_date <= $3::date)
     GROUP BY i.product_name
     HAVING AVG(i.rating) <= 3.5
     ORDER BY avg ASC, count DESC
     LIMIT 10`,
    params,
  );

  return {
    total: Number(agg.total ?? 0),
    newCount: Number(agg.new_count ?? 0),
    averages,
    overallAvg: weightedCount > 0 ? Math.round((weightedSum / weightedCount) * 100) / 100 : null,
    byKind: kindRows.map((r) => ({ kind: r.kind, count: Number(r.count) })),
    menuIdeas: ideaRows.map((r) => ({ comment: r.comment, createdAt: r.created_at })),
    weakProducts: weakRows.map((r) => ({
      productName: r.product_name,
      avg: Math.round(Number(r.avg) * 100) / 100,
      count: Number(r.count),
    })),
    openIssues: Number(agg.open_issues ?? 0),
  };
}

// ═══ ของเดิม (0056) — API เดิม แต่อ่าน/เขียนตารางใหม่ ═════════
//
// ⚠️ ห้ามเปลี่ยนชื่อ/รูปร่างของ 4 อย่างข้างล่างนี้โดยไม่แก้ผู้เรียก:
//    submitOrderFeedback  ← app/api/public/orders/[token]/feedback/route.ts
//    getPosFeedback       ← app/api/pos/feedback/route.ts → dashboard ฝั่งร้าน
//    PosFeedbackItem / PosFeedbackSummary ← รูปร่าง JSON ที่ client คาดหวัง

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

/** ให้คะแนนได้เมื่ออาหารถึงมือลูกค้าแล้ว — ก่อนหน้านั้นคะแนนไม่มีความหมาย */
const ALLOWED_STATUSES = new Set(["ready", "completed"]);

/**
 * ลูกค้าให้คะแนนออเดอร์แบบเร็ว (ปุ่มดาวบนหน้าติดตามออเดอร์)
 *
 * เปลี่ยนจาก 0056: เขียนลง pos_feedback (kind='food') แทน pos_order_feedback
 * กฎ "1 ครั้ง/ออเดอร์" ยังอยู่ — ย้ายจาก UNIQUE(order_id) ไป
 * partial unique index (order_id, kind) ใน 0073
 *
 * ⚠️ ไม่ให้แต้มทางนี้โดยเจตนา: เส้นทางแต้มมีที่เดียวคือ createPublicFeedback
 *    (ที่ตรวจบิลจริง + กันฟาร์ม) ถ้าให้แต้มสองที่ กฎกันฟาร์มจะรั่วทันที
 */
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
      bill_id: string | null;
    }>(
      `SELECT id, user_id, order_no, status, bill_id FROM pos_orders
       WHERE access_token = $1
       FOR UPDATE`,
      [accessToken],
    );
    const order = rows[0];
    if (!order) throw new FeedbackOrderNotFoundError();
    if (!ALLOWED_STATUSES.has(order.status)) throw new FeedbackNotAllowedYetError();

    const businessDate = await businessDateToday(order.user_id, client);
    const { rowCount } = await client.query(
      `INSERT INTO pos_feedback (
         user_id, member_id, order_id, bill_id, kind,
         rating_overall, comment, business_date, points_awarded, source
       )
       SELECT $1, o.member_id, $2, $3, 'food', $4, $5, $6::date, 0, 'quick'
       FROM pos_orders o WHERE o.id = $2
       ON CONFLICT DO NOTHING`,
      [
        order.user_id,
        order.id,
        order.bill_id,
        input.rating,
        input.comment?.trim() || null,
        businessDate,
      ],
    );
    if ((rowCount ?? 0) === 0) throw new FeedbackAlreadyExistsError();

    await client.query("COMMIT");
    return { orderNo: order.order_no, rating: input.rating };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
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

/**
 * สรุปดาวสำหรับ dashboard (รูปแบบเดิม)
 *
 * นับจาก rating_overall ของทุก feedback ที่ให้คะแนนรวมไว้ (ทั้ง source quick และ center)
 * และจาก Feedback Center · orderNo เป็น "" เมื่อ feedback มาจาก QR หน้าร้าน
 * (ไม่มีออเดอร์ผูก) — client แสดงเป็น "จาก QR หน้าร้าน" ได้
 */
export async function getPosFeedback(
  userId: string,
  limit = 20,
): Promise<PosFeedbackSummary> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const [{ rows: stats }, { rows: recent }] = await Promise.all([
    pool.query<{ rating: number; c: string }>(
      `SELECT rating_overall AS rating, COUNT(*)::text AS c
       FROM pos_feedback
       WHERE user_id = $1 AND rating_overall IS NOT NULL
       GROUP BY rating_overall`,
      [userId],
    ),
    pool.query<{
      id: string;
      order_no: string | null;
      rating: number;
      comment: string | null;
      created_at: Date | string;
    }>(
      `SELECT f.id, o.order_no, f.rating_overall AS rating, f.comment, f.created_at
       FROM pos_feedback f
       LEFT JOIN pos_orders o ON o.id = f.order_id
       WHERE f.user_id = $1 AND f.rating_overall IS NOT NULL
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
      orderNo: r.order_no ?? "",
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  };
}

export async function updatePosFeedbackStatus(
  userId: string,
  id: string,
  patch: { status?: FeedbackStatus; staffNote?: string | null },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE pos_feedback
     SET status     = COALESCE($3, status),
         staff_note = COALESCE($4, staff_note),
         updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, id, patch.status ?? null, patch.staffNote ?? null],
  );
  return (rowCount ?? 0) > 0;
}
