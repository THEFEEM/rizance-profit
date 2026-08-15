import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import {
  evaluateCampaign,
  type CampaignEvaluation,
  type CampaignRule,
  type EngineLine,
} from "@/lib/pos-campaign-engine";

/**
 * Ninenon Campaigns — DB layer (0074)
 *
 * ═══ กฎที่ไฟล์นี้บังคับ ═══════════════════════════════════════
 * 1) recordCampaignUsage ต้องเรียกใน transaction เดียวกับการปิดบิลเสมอ
 *    บิลล้ม = usage หาย · usage ล้ม = บิลไม่เกิด — ไม่มีสถานะครึ่ง ๆ
 * 2) usage limit บังคับด้วย atomic UPDATE (DB ตัดสิน ไม่ใช่ if ใน code)
 * 3) ห้าม hard delete campaign ที่มี usage — archive เท่านั้น
 * 4) แก้ discount rule ของ campaign ที่มี usage แล้วไม่ได้ (ประวัติจะโกหก)
 */

export class CampaignNotFoundError extends Error {
  constructor() {
    super("campaign_not_found");
    this.name = "CampaignNotFoundError";
  }
}
export class CampaignUsageLimitError extends Error {
  constructor() {
    super("usage_limit_reached");
    this.name = "CampaignUsageLimitError";
  }
}
export class CampaignImmutableError extends Error {
  constructor() {
    super("campaign_has_usage");
    this.name = "CampaignImmutableError";
  }
}

type Row = {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  status: CampaignRule["status"];
  discount_type: CampaignRule["discountType"];
  discount_value: string;
  scope: CampaignRule["scope"];
  minimum_order_amount: string;
  maximum_discount_amount: string | null;
  usage_limit: number | null;
  usage_limit_per_customer: number | null;
  used_count: number;
  start_at: string | null;
  end_at: string | null;
  time_start_min: number | null;
  time_end_min: number | null;
  days_of_week: string | null;
  eligibility: CampaignRule["eligibility"];
  created_at: string;
  product_ids: string[] | null;
  product_names: string[] | null;
};

export type PosCampaign = CampaignRule & {
  description: string | null;
  productNames: string[];
  createdAt: string;
};

const RETURN = `c.id, c.name, c.description, c.code, c.status,
  c.discount_type, c.discount_value::text AS discount_value, c.scope,
  c.minimum_order_amount::text AS minimum_order_amount,
  c.maximum_discount_amount::text AS maximum_discount_amount,
  c.usage_limit, c.usage_limit_per_customer, c.used_count,
  c.start_at, c.end_at, c.time_start_min, c.time_end_min, c.days_of_week,
  c.eligibility, c.created_at,
  (SELECT array_agg(cp.product_id) FROM pos_campaign_products cp
   WHERE cp.campaign_id = c.id) AS product_ids,
  (SELECT array_agg(p.name) FROM pos_campaign_products cp
   JOIN pos_products p ON p.id = cp.product_id
   WHERE cp.campaign_id = c.id) AS product_names`;

function mapRow(r: Row): PosCampaign {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    code: r.code,
    status: r.status,
    discountType: r.discount_type,
    discountValue: r.discount_value,
    scope: r.scope,
    productIds: r.product_ids ?? [],
    productNames: r.product_names ?? [],
    minimumOrderAmount: r.minimum_order_amount,
    maximumDiscountAmount: r.maximum_discount_amount,
    usageLimit: r.usage_limit,
    usageLimitPerCustomer: r.usage_limit_per_customer,
    usedCount: Number(r.used_count),
    startAt: r.start_at ? String(r.start_at) : null,
    endAt: r.end_at ? String(r.end_at) : null,
    timeStartMin: r.time_start_min,
    timeEndMin: r.time_end_min,
    daysOfWeek: r.days_of_week,
    eligibility: r.eligibility,
    createdAt: String(r.created_at),
  };
}

export async function listPosCampaigns(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<PosCampaign[]> {
  const { rows } = await pool.query<Row>(
    `SELECT ${RETURN} FROM pos_campaigns c
     WHERE c.user_id = $1 AND ($2 OR c.status <> 'archived')
     ORDER BY (c.status = 'active') DESC, c.created_at DESC`,
    [userId, opts.includeArchived ?? false],
  );
  return rows.map(mapRow);
}

export async function getPosCampaign(
  userId: string,
  id: string,
  client?: PoolClient,
): Promise<PosCampaign | null> {
  const q = client ?? pool;
  const { rows } = await q.query<Row>(
    `SELECT ${RETURN} FROM pos_campaigns c WHERE c.user_id = $1 AND c.id = $2`,
    [userId, id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export type UpsertCampaignInput = {
  name: string;
  description?: string | null;
  code?: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  scope: "entire_order" | "products";
  productIds?: string[];
  minimumOrderAmount?: number;
  maximumDiscountAmount?: number | null;
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  timeStartMin?: number | null;
  timeEndMin?: number | null;
  daysOfWeek?: string | null;
  eligibility?: "all" | "members";
};

export async function createPosCampaign(
  userId: string,
  input: UpsertCampaignInput,
): Promise<PosCampaign> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO pos_campaigns
         (user_id, name, description, code, status, discount_type, discount_value, scope,
          minimum_order_amount, maximum_discount_amount, usage_limit, usage_limit_per_customer,
          start_at, end_at, time_start_min, time_end_min, days_of_week, eligibility)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        userId, input.name.trim(), input.description?.trim() || null,
        input.code?.trim().toUpperCase() || null,
        input.discountType, input.discountValue.toFixed(2), input.scope,
        (input.minimumOrderAmount ?? 0).toFixed(2),
        input.maximumDiscountAmount != null ? input.maximumDiscountAmount.toFixed(2) : null,
        input.usageLimit ?? null, input.usageLimitPerCustomer ?? null,
        input.startAt ?? null, input.endAt ?? null,
        input.timeStartMin ?? null, input.timeEndMin ?? null,
        input.daysOfWeek ?? null, input.eligibility ?? "all",
      ],
    );
    await syncScope(client, userId, rows[0].id, input);
    await client.query("COMMIT");
    return (await getPosCampaign(userId, rows[0].id))!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function syncScope(
  client: PoolClient,
  userId: string,
  campaignId: string,
  input: Pick<UpsertCampaignInput, "scope" | "productIds">,
) {
  await client.query(`DELETE FROM pos_campaign_products WHERE campaign_id = $1`, [campaignId]);
  if (input.scope !== "products") return;
  for (const pid of input.productIds ?? []) {
    // ตรวจว่าเป็นสินค้าของร้านนี้จริง — กันยัด id ร้านอื่น
    await client.query(
      `INSERT INTO pos_campaign_products (campaign_id, product_id)
       SELECT $1, p.id FROM pos_products p WHERE p.id = $2 AND p.user_id = $3
       ON CONFLICT DO NOTHING`,
      [campaignId, pid, userId],
    );
  }
}

/**
 * แก้ campaign — มี usage แล้วห้ามแก้ discount rule (ประวัติ/analytics จะโกหก)
 * แก้ได้เฉพาะ: name, description, end_at (ปิดเร็วขึ้น/ต่ออายุ), usage_limit (เพิ่ม)
 */
export async function updatePosCampaign(
  userId: string,
  id: string,
  input: Partial<UpsertCampaignInput>,
): Promise<PosCampaign> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ used_count: number }>(
      `SELECT used_count FROM pos_campaigns
       WHERE id = $2 AND user_id = $1 FOR UPDATE`,
      [userId, id],
    );
    if (!rows[0]) throw new CampaignNotFoundError();
    const hasUsage = Number(rows[0].used_count) > 0;

    const wantsRuleChange =
      input.discountType !== undefined ||
      input.discountValue !== undefined ||
      input.scope !== undefined ||
      input.productIds !== undefined ||
      input.minimumOrderAmount !== undefined ||
      input.maximumDiscountAmount !== undefined ||
      input.code !== undefined;
    if (hasUsage && wantsRuleChange) throw new CampaignImmutableError();

    await client.query(
      `UPDATE pos_campaigns SET
         name        = COALESCE($3, name),
         description = COALESCE($4, description),
         code        = CASE WHEN $5 THEN upper($6) ELSE code END,
         discount_type  = COALESCE($7, discount_type),
         discount_value = COALESCE($8::numeric, discount_value),
         scope          = COALESCE($9, scope),
         minimum_order_amount    = COALESCE($10::numeric, minimum_order_amount),
         maximum_discount_amount = CASE WHEN $11 THEN $12::numeric ELSE maximum_discount_amount END,
         usage_limit              = CASE WHEN $13 THEN $14 ELSE usage_limit END,
         usage_limit_per_customer = CASE WHEN $15 THEN $16 ELSE usage_limit_per_customer END,
         start_at = CASE WHEN $17 THEN $18::timestamptz ELSE start_at END,
         end_at   = CASE WHEN $19 THEN $20::timestamptz ELSE end_at END,
         time_start_min = CASE WHEN $21 THEN $22 ELSE time_start_min END,
         time_end_min   = CASE WHEN $23 THEN $24 ELSE time_end_min END,
         days_of_week   = CASE WHEN $25 THEN $26 ELSE days_of_week END,
         eligibility    = COALESCE($27, eligibility),
         updated_at = now()
       WHERE id = $2 AND user_id = $1`,
      [
        userId, id,
        input.name?.trim() ?? null, input.description?.trim() ?? null,
        input.code !== undefined, input.code?.trim() || null,
        input.discountType ?? null,
        input.discountValue !== undefined ? input.discountValue.toFixed(2) : null,
        input.scope ?? null,
        input.minimumOrderAmount !== undefined ? input.minimumOrderAmount.toFixed(2) : null,
        input.maximumDiscountAmount !== undefined,
        input.maximumDiscountAmount != null ? input.maximumDiscountAmount.toFixed(2) : null,
        input.usageLimit !== undefined, input.usageLimit ?? null,
        input.usageLimitPerCustomer !== undefined, input.usageLimitPerCustomer ?? null,
        input.startAt !== undefined, input.startAt ?? null,
        input.endAt !== undefined, input.endAt ?? null,
        input.timeStartMin !== undefined, input.timeStartMin ?? null,
        input.timeEndMin !== undefined, input.timeEndMin ?? null,
        input.daysOfWeek !== undefined, input.daysOfWeek ?? null,
        input.eligibility ?? null,
      ],
    );
    if (!hasUsage && input.productIds !== undefined && input.scope !== undefined) {
      await syncScope(client, userId, id, { scope: input.scope, productIds: input.productIds });
    }
    await client.query("COMMIT");
    return (await getPosCampaign(userId, id))!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** เปลี่ยนสถานะ: activate / pause / archive — ไม่มี delete */
export async function setPosCampaignStatus(
  userId: string,
  id: string,
  status: "active" | "paused" | "archived" | "draft",
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE pos_campaigns SET status = $3, updated_at = now()
     WHERE id = $2 AND user_id = $1`,
    [userId, id, status],
  );
  return (rowCount ?? 0) > 0;
}

/** duplicate: copy rule ทั้งหมด → draft ใหม่ ชื่อต่อท้าย (สำเนา) · code ไม่ copy (unique) */
export async function duplicatePosCampaign(userId: string, id: string): Promise<PosCampaign> {
  const src = await getPosCampaign(userId, id);
  if (!src) throw new CampaignNotFoundError();
  return createPosCampaign(userId, {
    name: `${src.name} (สำเนา)`.slice(0, 120),
    description: src.description,
    code: null,
    discountType: src.discountType as "percentage" | "fixed",
    discountValue: Number(src.discountValue),
    scope: src.scope,
    productIds: src.productIds,
    minimumOrderAmount: Number(src.minimumOrderAmount),
    maximumDiscountAmount: src.maximumDiscountAmount ? Number(src.maximumDiscountAmount) : null,
    usageLimit: src.usageLimit,
    usageLimitPerCustomer: src.usageLimitPerCustomer,
    startAt: src.startAt,
    endAt: src.endAt,
    timeStartMin: src.timeStartMin,
    timeEndMin: src.timeEndMin,
    daysOfWeek: src.daysOfWeek,
    eligibility: src.eligibility,
  });
}

/** หา campaign ด้วย coupon code (case-insensitive, เฉพาะที่ไม่ archived) */
export async function findCampaignByCode(
  userId: string,
  code: string,
  client?: PoolClient,
): Promise<PosCampaign | null> {
  const q = client ?? pool;
  const { rows } = await q.query<Row>(
    `SELECT ${RETURN} FROM pos_campaigns c
     WHERE c.user_id = $1 AND upper(c.code) = upper($2) AND c.status <> 'archived'`,
    [userId, code.trim()],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** จำนวนครั้งที่สมาชิกใช้ campaign นี้ไปแล้ว */
export async function countCustomerUsage(
  campaignId: string,
  memberId: string,
  client?: PoolClient,
): Promise<number> {
  const q = client ?? pool;
  const { rows } = await q.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM pos_campaign_usages
     WHERE campaign_id = $1 AND member_id = $2`,
    [campaignId, memberId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * validate + คำนวณ (read-only) — ใช้ทั้ง preview ก่อนเก็บเงิน และใน closePosBill
 * client ส่งแค่ campaignId/code — จำนวนเงินทุกบาทเกิดที่นี่
 */
export async function validateCampaignForCart(args: {
  userId: string;
  campaignId?: string;
  couponCode?: string;
  lines: EngineLine[];
  memberId: string | null;
  client?: PoolClient;
}): Promise<{ campaign: PosCampaign; evaluation: CampaignEvaluation }> {
  const { userId, lines, memberId, client } = args;
  const campaign = args.campaignId
    ? await getPosCampaign(userId, args.campaignId, client)
    : args.couponCode
      ? await findCampaignByCode(userId, args.couponCode, client)
      : null;
  if (!campaign) throw new CampaignNotFoundError();

  const customerUsedCount =
    memberId !== null ? await countCustomerUsage(campaign.id, memberId, client) : null;

  const evaluation = evaluateCampaign({
    campaign,
    lines,
    customerUsedCount,
    hasMember: memberId !== null,
  });
  return { campaign, evaluation };
}

/**
 * บันทึกการใช้ — ⭐ ต้องอยู่ใน transaction เดียวกับการปิดบิล
 *
 * ลำดับสำคัญ:
 * 1) atomic UPDATE used_count — DB ปฏิเสธเมื่อเต็ม (กัน concurrent เกิน limit)
 *    และการ UPDATE ล็อกแถว campaign → ขั้นตอนถัดไป serialize ต่อ campaign เดียวกัน
 * 2) นับ per-customer ซ้ำหลังได้ล็อก (pre-check ใน engine อาจแพ้ race — ที่นี่ไม่แพ้)
 * 3) INSERT usage log (unique bill_id กัน double-apply)
 */
export async function recordCampaignUsage(
  client: PoolClient,
  userId: string,
  args: {
    campaignId: string;
    billId: string;
    billNo: string;
    memberId: string | null;
    couponCode: string | null;
    discountAmount: string;
    orderSubtotal: string;
    orderTotal: string;
    usageLimitPerCustomer: number | null;
  },
): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE pos_campaigns
     SET used_count = used_count + 1, updated_at = now()
     WHERE id = $2 AND user_id = $1 AND status = 'active'
       AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [userId, args.campaignId],
  );
  if (!rowCount) throw new CampaignUsageLimitError();

  if (args.usageLimitPerCustomer !== null && args.memberId) {
    const used = await countCustomerUsage(args.campaignId, args.memberId, client);
    if (used >= args.usageLimitPerCustomer) throw new CampaignUsageLimitError();
  }

  await client.query(
    `INSERT INTO pos_campaign_usages
       (user_id, campaign_id, bill_id, bill_no, member_id, coupon_code,
        discount_amount, order_total, order_subtotal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId, args.campaignId, args.billId, args.billNo, args.memberId,
      args.couponCode, args.discountAmount, args.orderTotal, args.orderSubtotal,
    ],
  );
}

/** analytics ต่อ campaign — เฉพาะตัวเลขที่มีข้อมูลจริงรองรับ (ไม่มี ROI ปลอม) */
export type CampaignAnalytics = {
  usageCount: number;
  totalDiscount: string;
  totalSales: string;
  avgOrder: string | null;
  uniqueCustomers: number;
  recent: {
    billNo: string | null;
    memberId: string | null;
    discountAmount: string;
    orderTotal: string;
    createdAt: string;
  }[];
};

export async function getCampaignAnalytics(
  userId: string,
  campaignId: string,
): Promise<CampaignAnalytics> {
  const [{ rows: agg }, { rows: recent }] = await Promise.all([
    pool.query<{
      n: string;
      discount: string;
      sales: string;
      avg_order: string | null;
      customers: string;
    }>(
      `SELECT COUNT(*)::text AS n,
              COALESCE(SUM(discount_amount), 0)::text AS discount,
              COALESCE(SUM(order_total), 0)::text AS sales,
              ROUND(AVG(order_total), 2)::text AS avg_order,
              COUNT(DISTINCT member_id) FILTER (WHERE member_id IS NOT NULL)::text AS customers
       FROM pos_campaign_usages WHERE user_id = $1 AND campaign_id = $2`,
      [userId, campaignId],
    ),
    pool.query<{
      bill_no: string | null;
      member_id: string | null;
      discount_amount: string;
      order_total: string;
      created_at: string;
    }>(
      `SELECT bill_no, member_id, discount_amount::text, order_total::text, created_at
       FROM pos_campaign_usages WHERE user_id = $1 AND campaign_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [userId, campaignId],
    ),
  ]);
  const a = agg[0];
  return {
    usageCount: Number(a?.n ?? 0),
    totalDiscount: a?.discount ?? "0",
    totalSales: a?.sales ?? "0",
    avgOrder: a?.avg_order ?? null,
    uniqueCustomers: Number(a?.customers ?? 0),
    recent: recent.map((r) => ({
      billNo: r.bill_no,
      memberId: r.member_id,
      discountAmount: r.discount_amount,
      orderTotal: r.order_total,
      createdAt: String(r.created_at),
    })),
  };
}
