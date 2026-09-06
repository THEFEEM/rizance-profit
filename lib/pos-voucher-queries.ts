/**
 * Gift Voucher — service layer (0094)
 *
 * กติกาที่ล็อกไว้ (AUDIT-gift-voucher.md · decision A ทั้ง 5):
 *   · tenant = user_id ทุก query · public lookup ด้วย token_hash เท่านั้น
 *   · voucher = ส่วนลด ฝังบรรทัดผ่าน evaluateCampaign() ด้วย rule สังเคราะห์
 *   · redeem atomic: FOR UPDATE → UPDATE … WHERE status='active' RETURNING → INSERT redemption (UNIQUE)
 *     ทั้งหมดใน transaction เดียวกับบิล (closePosBill)
 *   · raw token คืนครั้งเดียวตอน generate — DB ไม่มี
 *   · 'expired' ไม่เก็บใน DB — derive จาก expires_at ตอนอ่าน
 */
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { toCents, centsToDecimalString } from "@/lib/money";
import {
  evaluateCampaign,
  type CampaignRule,
  type CampaignEvaluation,
  type EngineLine,
} from "@/lib/pos-campaign-engine";
import {
  MANUAL_ALLOWED_VOUCHER_TYPES,
  REDEEMABLE_VOUCHER_TYPES,
  designConfigSchema,
  resolveCardBrand,
  type GenerationMode,
  type ManualRangeCreateInput,
  type ResolvedCardBrand,
  type VoucherCampaignInput,
  type VoucherDesignConfig,
  type VoucherType,
} from "@/lib/pos-voucher-schema";
import {
  formatPublicCode,
  generateVoucherToken,
  hashVoucherToken,
  parseVoucherToken,
  voucherCardUrl,
} from "@/lib/pos-voucher-token";
import {
  checkManualRangeInput,
  formatManualCode,
  isValidCustomCode,
  manualRangeSize,
  manualRangesOverlap,
  normalizeManualCode,
  parseManualCode,
} from "@/lib/pos-voucher-manual-code";
import { toCsv } from "@/lib/pos-export-queries";

type Q = Pick<PoolClient, "query">;
const db = (c?: Q): Q => c ?? pool;

// ═══ errors ═══════════════════════════════════════════════════════

export class VoucherCampaignNotFoundError extends Error {
  constructor() {
    super("voucher_campaign_not_found");
    this.name = "VoucherCampaignNotFoundError";
  }
}
export class VoucherNotFoundError extends Error {
  constructor() {
    super("voucher_not_found");
    this.name = "VoucherNotFoundError";
  }
}
export class VoucherCampaignImmutableError extends Error {
  constructor(public readonly field: string) {
    super(`voucher_campaign_immutable:${field}`);
    this.name = "VoucherCampaignImmutableError";
  }
}
export class VoucherStateError extends Error {
  constructor(public readonly reason: string) {
    super(`voucher_state:${reason}`);
    this.name = "VoucherStateError";
  }
}

/** เหตุผลปฏิเสธ — machine code ให้ client แปล (ดู CAMPAIGN_REJECT_TEXT pattern) */
export type VoucherRejectReason =
  | "VOUCHER_NOT_FOUND"
  | "WRONG_BUSINESS"
  | "WRONG_BRANCH"
  | "VOUCHER_NOT_ACTIVE"
  | "VOUCHER_ALREADY_REDEEMED"
  | "VOUCHER_BLOCKED"
  | "VOUCHER_CANCELLED"
  | "VOUCHER_EXPIRED"
  | "VOUCHER_NOT_STARTED"
  | "CAMPAIGN_INACTIVE"
  | "UNSUPPORTED_VOUCHER_TYPE"
  | "NO_ELIGIBLE_ITEMS"
  | "MINIMUM_SPEND_NOT_REACHED"
  | "STACKED_DISCOUNT";

export class PosVoucherRejectedError extends Error {
  constructor(
    public readonly reason: VoucherRejectReason,
    /** ข้อมูลที่เปิดเผยได้ เช่น redeemedAt/billNo — ไม่มี staff/customer */
    public readonly info: Record<string, string | null> = {},
    /** สำหรับ audit log ฝั่ง server เท่านั้น — route ห้ามส่งออก */
    public readonly internal: { voucherId: string | null; campaignId: string | null } = {
      voucherId: null,
      campaignId: null,
    },
  ) {
    super(`voucher_rejected:${reason}`);
    this.name = "PosVoucherRejectedError";
  }
}

// ═══ types ════════════════════════════════════════════════════════

export type VoucherCampaignStatus = "draft" | "active" | "paused" | "ended" | "archived";
export type VoucherStatus = "issued" | "active" | "redeemed" | "expired" | "cancelled" | "blocked";

/**
 * สถิติ Manual Code (V2.1) — semantic ต่างจาก secure: ไม่มี "ใบที่ออก" มีแค่ "code ที่ตั้งไว้"
 *   configured = Σ ขนาดช่วง (active+paused · ไม่นับ archived) + custom
 *   redeemed   = แถวใน redemptions (mode=manual) · remaining = configured − redeemed
 */
export type ManualCodeStats = {
  configured: number;
  redeemed: number;
  remaining: number;
  redemptionRate: number;
  ranges: number;
};

export type VoucherCampaign = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  sponsor: string | null;
  /** secure (ใบ+token) | manual_range (ช่วงเลข · code derive เอง) */
  generationMode: GenerationMode;
  /** เฉพาะ manual_range — secure = null */
  manual: ManualCodeStats | null;
  voucherType: string;
  value: string;
  /** ยอดซื้อขั้นต่ำ (บาท string) — "0.00" = ไม่มี */
  minimumSpend: string;
  /** ลดสูงสุด (percentage เท่านั้น) — null = ไม่จำกัด */
  maximumDiscount: string | null;
  quantityPlanned: number | null;
  usageLimitPerVoucher: number;
  startAt: string;
  expiresAt: string;
  status: VoucherCampaignStatus;
  codePrefix: string;
  terms: string | null;
  designConfig: VoucherDesignConfig;
  allowedBranchIds: string[] | null;
  createdAt: string;
  updatedAt: string;
  /** นับจาก pos_vouchers */
  stats: VoucherCampaignStats;
};

export type VoucherCampaignStats = {
  issued: number;
  active: number;
  redeemed: number;
  expired: number;
  cancelled: number;
  blocked: number;
  redemptionRate: number; // 0–1
};

export type Voucher = {
  id: string;
  campaignId: string;
  publicCode: string;
  /** สถานะที่ derive แล้ว (active + หมดอายุ → expired) */
  status: VoucherStatus;
  issuedAt: string;
  activatedAt: string | null;
  redeemedAt: string | null;
  redeemedBillId: string | null;
  redeemedBillNo: string | null;
  memberId: string | null;
  expiresAt: string;
  batchId: string | null;
  batchName: string | null;
  distributionSource: string | null;
};

type CampaignRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  sponsor: string | null;
  voucher_type: string;
  value: string;
  minimum_spend: string | null;
  maximum_discount: string | null;
  quantity_planned: number | null;
  usage_limit_per_voucher: number;
  start_at: Date | string;
  expires_at: Date | string;
  status: VoucherCampaignStatus;
  code_prefix: string;
  terms: string | null;
  design_config: unknown;
  allowed_branch_ids: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
  generation_mode: GenerationMode | null;
  n_issued: string;
  n_active: string;
  n_active_expired: string;
  n_redeemed: string;
  n_cancelled: string;
  n_blocked: string;
  m_configured: string;
  m_ranges: string;
  m_redeemed: string;
};

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));
const int = (v: string | number | null | undefined): number => Number(v ?? 0);

/** สถานะที่ผู้ใช้เห็น — active ที่เลยเวลาแล้วคือ expired */
export function deriveVoucherStatus(
  stored: VoucherStatus,
  expiresAt: Date | string,
  now = new Date(),
): VoucherStatus {
  if ((stored === "active" || stored === "issued") && now > new Date(expiresAt)) return "expired";
  return stored;
}

function mapCampaign(r: CampaignRow): VoucherCampaign {
  const mode: GenerationMode = r.generation_mode === "manual_range" ? "manual_range" : "secure";
  const parsedDesign = designConfigSchema.safeParse(r.design_config ?? {});
  let manual: ManualCodeStats | null = null;
  let issued = int(r.n_issued);
  let redeemed = int(r.n_redeemed);
  let stats: VoucherCampaignStats;
  if (mode === "manual_range") {
    // ไม่มีแถวใบ — "issued" ในความหมาย stats = code ที่ตั้งไว้ (ใช้ล็อก value/prefix หลังแจกการ์ดเหมือน secure)
    const configured = int(r.m_configured);
    redeemed = int(r.m_redeemed);
    issued = configured;
    const expired = new Date(r.expires_at) < new Date() ? Math.max(0, configured - redeemed) : 0;
    manual = {
      configured, redeemed, remaining: Math.max(0, configured - redeemed),
      redemptionRate: configured > 0 ? redeemed / configured : 0, ranges: int(r.m_ranges),
    };
    stats = {
      issued: configured, active: Math.max(0, configured - redeemed - expired), redeemed, expired,
      cancelled: 0, blocked: 0, redemptionRate: manual.redemptionRate,
    };
  } else {
    stats = {
      issued,
      active: int(r.n_active) - int(r.n_active_expired),
      redeemed,
      expired: int(r.n_active_expired),
      cancelled: int(r.n_cancelled),
      blocked: int(r.n_blocked),
      redemptionRate: issued > 0 ? redeemed / issued : 0,
    };
  }
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    sponsor: r.sponsor,
    generationMode: mode,
    manual,
    voucherType: r.voucher_type,
    value: r.value,
    minimumSpend: r.minimum_spend ?? "0.00",
    maximumDiscount: r.maximum_discount,
    quantityPlanned: r.quantity_planned,
    usageLimitPerVoucher: r.usage_limit_per_voucher,
    startAt: iso(r.start_at),
    expiresAt: iso(r.expires_at),
    status: r.status,
    codePrefix: r.code_prefix,
    terms: r.terms,
    designConfig: parsedDesign.success ? parsedDesign.data : designConfigSchema.parse({}),
    allowedBranchIds: r.allowed_branch_ids,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    stats,
  };
}

/**
 * SELECT เดียวใช้ทั้ง list/get — นับสถิติด้วย subquery aggregate ไม่โหลด voucher ทั้งก้อน
 * V2.1: + manual aggregate (ขนาดช่วงจากตัวเลข ไม่ต้องมีแถวใบ · redeemed จาก redemptions mode=manual)
 */
const CAMPAIGN_SELECT = `
  SELECT c.*,
    COALESCE(s.n_issued, 0)::text          AS n_issued,
    COALESCE(s.n_active, 0)::text          AS n_active,
    COALESCE(s.n_active_expired, 0)::text  AS n_active_expired,
    COALESCE(s.n_redeemed, 0)::text        AS n_redeemed,
    COALESCE(s.n_cancelled, 0)::text       AS n_cancelled,
    COALESCE(s.n_blocked, 0)::text         AS n_blocked,
    COALESCE(m.configured, 0)::text        AS m_configured,
    COALESCE(m.n_ranges, 0)::text          AS m_ranges,
    COALESCE(mr.n, 0)::text                AS m_redeemed
  FROM pos_voucher_campaigns c
  LEFT JOIN LATERAL (
    SELECT count(*)                                              AS n_issued,
           count(*) FILTER (WHERE v.status IN ('active','issued')) AS n_active,
           count(*) FILTER (WHERE v.status IN ('active','issued')
                              AND c.expires_at < now())        AS n_active_expired,
           count(*) FILTER (WHERE v.status = 'redeemed')       AS n_redeemed,
           count(*) FILTER (WHERE v.status = 'cancelled')      AS n_cancelled,
           count(*) FILTER (WHERE v.status = 'blocked')        AS n_blocked
    FROM pos_vouchers v WHERE v.campaign_id = c.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN r.kind = 'range' THEN r.end_number - r.start_number + 1 ELSE 1 END) AS configured,
           count(*) AS n_ranges
    FROM pos_voucher_manual_ranges r WHERE r.campaign_id = c.id AND r.status <> 'archived'
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM pos_voucher_redemptions rd
    JOIN pos_voucher_manual_ranges r2 ON r2.id = rd.manual_range_id
    WHERE rd.campaign_id = c.id AND rd.redemption_mode = 'manual' AND r2.status <> 'archived'
  ) mr ON true`;

// ═══ audit events ═════════════════════════════════════════════════

export type VoucherActor = "owner" | "staff" | "public" | "system";

export async function logVoucherEvent(
  c: Q,
  userId: string,
  e: {
    campaignId: string | null;
    voucherId: string | null;
    actor: VoucherActor;
    action: string;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO pos_voucher_events (user_id, campaign_id, voucher_id, actor, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, e.campaignId, e.voucherId, e.actor, e.action, e.detail ?? null],
  );
}

// ═══ campaigns ════════════════════════════════════════════════════

export async function listVoucherCampaigns(userId: string): Promise<VoucherCampaign[]> {
  const { rows } = await pool.query<CampaignRow>(
    `${CAMPAIGN_SELECT}
     WHERE c.user_id = $1 AND c.status <> 'archived'
     ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(mapCampaign);
}

export async function getVoucherCampaign(
  userId: string,
  id: string,
  client?: Q,
): Promise<VoucherCampaign> {
  const { rows } = await db(client).query<CampaignRow>(
    `${CAMPAIGN_SELECT} WHERE c.user_id = $1 AND c.id = $2`,
    [userId, id],
  );
  if (!rows[0]) throw new VoucherCampaignNotFoundError();
  return mapCampaign(rows[0]);
}

/** pg unique violation → 23505 (ใช้แยก "ชนกัน" ออกจาก error อื่นให้เป็น 409 ไม่ใช่ 500) */
const isUniqueViolation = (e: unknown, constraint?: string): boolean => {
  const pe = e as { code?: string; constraint?: string } | null;
  return Boolean(pe && pe.code === "23505" && (!constraint || pe.constraint === constraint));
};

/**
 * prefix ต้อง unique ต่อร้านในแคมเปญที่ยังไม่ archive (ทั้ง secure/manual) — code ทั้งร้านต้อง resolve ทางเดียว
 * (บั๊ก V1: UNIQUE(user_id, public_code) + เลขรันต่อแคมเปญ → prefix ซ้ำ = generate ล้ม 23505 → "unknown_error")
 */
async function assertPrefixAvailable(c: Q, userId: string, prefix: string, exceptCampaignId: string | null): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM pos_voucher_campaigns
     WHERE user_id = $1 AND code_prefix = $2 AND status <> 'archived' AND ($3::uuid IS NULL OR id <> $3)
     LIMIT 1`,
    [userId, prefix, exceptCampaignId],
  );
  if (rows[0]) throw new VoucherStateError("prefix_in_use");
}

export async function createVoucherCampaign(
  userId: string,
  input: VoucherCampaignInput,
): Promise<VoucherCampaign> {
  const mode: GenerationMode = input.generationMode ?? "secure";
  if (mode === "manual_range" && !MANUAL_ALLOWED_VOUCHER_TYPES.includes(input.voucherType)) {
    throw new VoucherStateError("manual_type_not_allowed");
  }
  await assertPrefixAvailable(pool, userId, input.codePrefix, null);
  let rows: { id: string }[];
  try {
    ({ rows } = await pool.query<{ id: string }>(
      `INSERT INTO pos_voucher_campaigns
         (user_id, name, description, sponsor, voucher_type, value, quantity_planned,
          start_at, expires_at, code_prefix, terms, design_config, allowed_branch_ids,
          minimum_spend, maximum_discount, generation_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::uuid[],$14,$15,$16)
       RETURNING id`,
      [
        userId,
        input.name,
        input.description ?? null,
        input.sponsor ?? null,
        input.voucherType,
        centsToDecimalString(toCents(input.value)),
        input.quantityPlanned ?? null,
        input.startAt,
        input.expiresAt,
        input.codePrefix,
        input.terms ?? null,
        JSON.stringify(input.designConfig),
        input.allowedBranchIds ?? null,
        centsToDecimalString(toCents(input.minimumSpend ?? 0)),
        input.maximumDiscount != null ? centsToDecimalString(toCents(input.maximumDiscount)) : null,
        mode,
      ],
    ));
  } catch (e) {
    // race ระหว่าง assert กับ INSERT → unique index (0097) จับ → ตอบ 409 เหมือนกัน
    if (isUniqueViolation(e, "idx_pos_voucher_campaigns_prefix_live")) throw new VoucherStateError("prefix_in_use");
    throw e;
  }
  await logVoucherEvent(pool, userId, {
    campaignId: rows[0].id,
    voucherId: null,
    actor: "owner",
    action: "campaign_created",
    detail: { name: input.name, value: input.value, type: input.voucherType, minimumSpend: input.minimumSpend ?? 0, maximumDiscount: input.maximumDiscount ?? null, generationMode: mode },
  });
  return getVoucherCampaign(userId, rows[0].id);
}

/**
 * แก้แคมเปญ — หลังมี voucher ออกไปแล้ว ห้ามเปลี่ยน value/type/prefix
 * (การ์ดที่ลูกค้าถืออยู่เขียน ฿69 — เปลี่ยนเป็น ฿50 คือโกงลูกค้า)
 */
export async function updateVoucherCampaign(
  userId: string,
  id: string,
  input: VoucherCampaignInput,
): Promise<VoucherCampaign> {
  const current = await getVoucherCampaign(userId, id);
  // วิธีออกใบเปลี่ยนไม่ได้เลยหลังสร้าง (secure ↔ manual = คนละโครงสร้าง) — client ส่งค่าเดิมหรือไม่ส่งก็ได้
  if (input.generationMode && input.generationMode !== current.generationMode) {
    throw new VoucherCampaignImmutableError("generationMode");
  }
  if (input.codePrefix !== current.codePrefix) await assertPrefixAvailable(pool, userId, input.codePrefix, id);
  if (current.stats.issued > 0) {
    if (toCents(input.value) !== toCents(current.value)) throw new VoucherCampaignImmutableError("value");
    if (input.voucherType !== current.voucherType) throw new VoucherCampaignImmutableError("voucherType");
    if (input.codePrefix !== current.codePrefix) throw new VoucherCampaignImmutableError("codePrefix");
    // เงื่อนไขพิมพ์อยู่บนการ์ดแล้ว ("ขั้นต่ำ ฿100 · ลดสูงสุด ฿50") — เปลี่ยนหลังแจก = ผิดสัญญา
    if (toCents(input.minimumSpend ?? 0) !== toCents(current.minimumSpend)) throw new VoucherCampaignImmutableError("minimumSpend");
    const curMax = current.maximumDiscount == null ? null : toCents(current.maximumDiscount);
    const nextMax = input.maximumDiscount == null ? null : toCents(input.maximumDiscount);
    if (curMax !== nextMax) throw new VoucherCampaignImmutableError("maximumDiscount");
    // การ์ดที่ลูกค้าถือพิมพ์วันหมดอายุไว้แล้ว — ย่นให้สั้นลงไม่ได้ ขยายได้
    if (new Date(input.expiresAt) < new Date(current.expiresAt)) {
      throw new VoucherCampaignImmutableError("expiresAt");
    }
  }
  try {
    await pool.query(
      `UPDATE pos_voucher_campaigns SET
         name = $3, description = $4, sponsor = $5, voucher_type = $6, value = $7,
         quantity_planned = $8, start_at = $9, expires_at = $10, code_prefix = $11,
         terms = $12, design_config = $13::jsonb, allowed_branch_ids = $14::uuid[],
         minimum_spend = $15, maximum_discount = $16,
         updated_at = now()
       WHERE user_id = $1 AND id = $2`,
      [
        userId, id, input.name, input.description ?? null, input.sponsor ?? null,
        input.voucherType, centsToDecimalString(toCents(input.value)),
        input.quantityPlanned ?? null, input.startAt, input.expiresAt, input.codePrefix,
        input.terms ?? null, JSON.stringify(input.designConfig), input.allowedBranchIds ?? null,
        centsToDecimalString(toCents(input.minimumSpend ?? 0)),
        input.maximumDiscount != null ? centsToDecimalString(toCents(input.maximumDiscount)) : null,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e, "idx_pos_voucher_campaigns_prefix_live")) throw new VoucherStateError("prefix_in_use");
    throw e;
  }
  await logVoucherEvent(pool, userId, {
    campaignId: id, voucherId: null, actor: "owner", action: "campaign_updated", detail: null,
  });
  return getVoucherCampaign(userId, id);
}

/** archived = ปลายทาง (ใบทุกใบตายแล้ว ห้ามชุบ) · ended กลับมา active ไม่ได้ · ที่เหลือสลับได้ */
const CAMPAIGN_TRANSITIONS: Record<VoucherCampaignStatus, VoucherCampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "ended", "archived"],
  paused: ["active", "ended", "archived"],
  ended: ["archived"],
  archived: [],
};

export async function setVoucherCampaignStatus(
  userId: string,
  id: string,
  status: VoucherCampaignStatus,
): Promise<VoucherCampaign> {
  const current = await getVoucherCampaign(userId, id);
  if (!CAMPAIGN_TRANSITIONS[current.status].includes(status)) {
    throw new VoucherStateError(`campaign_${current.status}_to_${status}`);
  }
  const { rowCount } = await pool.query(
    `UPDATE pos_voucher_campaigns SET status = $3, updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = $4`,
    [userId, id, status, current.status],
  );
  if (!rowCount) throw new VoucherCampaignNotFoundError();
  await logVoucherEvent(pool, userId, {
    campaignId: id, voucherId: null, actor: "owner", action: "campaign_status", detail: { status },
  });
  return getVoucherCampaign(userId, id);
}

// ═══ generator ════════════════════════════════════════════════════

export type GeneratedVoucher = { id: string; publicCode: string; token: string; url: string };

export type VoucherBatch = {
  id: string;
  campaignId: string;
  name: string;
  distributionSource: string | null;
  quantityPlanned: number;
  quantityGenerated: number;
  createdAt: string;
};

export type GenerateResult = { vouchers: GeneratedVoucher[]; batch: VoucherBatch };

type BatchRow = {
  id: string; campaign_id: string; name: string; distribution_source: string | null;
  quantity_planned: number; quantity_generated: number; created_at: Date | string;
};
const mapBatch = (r: BatchRow): VoucherBatch => ({
  id: r.id, campaignId: r.campaign_id, name: r.name, distributionSource: r.distribution_source,
  quantityPlanned: Number(r.quantity_planned), quantityGenerated: Number(r.quantity_generated),
  createdAt: iso(r.created_at),
});

/**
 * Bulk generate — ล็อกแถวแคมเปญก่อนอ่านเลขล่าสุด → running number ไม่ชนแม้ยิงพร้อมกัน
 * raw token คืนเฉพาะที่นี่ ครั้งเดียว · DB เก็บ sha256
 * V2: ทุกครั้งสร้าง batch 1 แถว (ชื่อ · ช่องทางแจก) แล้วผูก vouchers.batch_id — ทั้งหมดใน transaction เดียว
 */
export async function generateVouchers(
  userId: string,
  campaignId: string,
  quantity: number,
  posAppBaseUrl: string,
  batch: { name?: string | null; distributionSource?: string | null } = {},
): Promise<GenerateResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: camp } = await client.query<{
      code_prefix: string; status: string; quantity_planned: number | null; generation_mode: string | null;
    }>(
      `SELECT code_prefix, status, quantity_planned, generation_mode FROM pos_voucher_campaigns
       WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, campaignId],
    );
    if (!camp[0]) throw new VoucherCampaignNotFoundError();
    if (camp[0].status === "archived" || camp[0].status === "ended") {
      throw new VoucherStateError("campaign_closed");
    }
    // แคมเปญ Manual Code ไม่มีใบ secure — ต้องไปเพิ่ม range แทน (คนละโครงสร้าง ห้ามปนใน campaign เดียว)
    if (camp[0].generation_mode === "manual_range") throw new VoucherStateError("manual_campaign");

    const { rows: seqRow } = await client.query<{ max_seq: string | null; n: string }>(
      `SELECT MAX(split_part(public_code, '-', 2)::int)::text AS max_seq, count(*)::text AS n
       FROM pos_vouchers WHERE campaign_id = $1`,
      [campaignId],
    );
    let seq = Number(seqRow[0]?.max_seq ?? 0);
    // ออกเกินแผนไม่ได้เงียบ ๆ — เจ้าของต้องแก้แผนก่อน (กันมือลั่น 1,000 แทน 100)
    const planned = camp[0].quantity_planned;
    if (planned !== null && Number(seqRow[0]?.n ?? 0) + quantity > planned) {
      throw new VoucherStateError("quantity_planned_exceeded");
    }

    const out: GeneratedVoucher[] = [];
    const codes: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < quantity; i++) {
      seq += 1;
      const token = generateVoucherToken();
      const publicCode = formatPublicCode(camp[0].code_prefix, seq);
      codes.push(publicCode);
      hashes.push(hashVoucherToken(token));
      out.push({ id: "", publicCode, token, url: voucherCardUrl(posAppBaseUrl, token) });
    }

    // batch — ชื่อดีฟอลต์ "Batch #n" ถ้าไม่กรอก · ช่องทางแจก free text
    const { rows: nb } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pos_voucher_batches WHERE campaign_id = $1`,
      [campaignId],
    );
    const batchName = batch.name?.trim() || `Batch #${Number(nb[0]?.n ?? 0) + 1}`;
    const { rows: batchRows } = await client.query<BatchRow>(
      `INSERT INTO pos_voucher_batches (user_id, campaign_id, name, distribution_source, quantity_planned, quantity_generated)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, campaign_id, name, distribution_source, quantity_planned, quantity_generated, created_at`,
      [userId, campaignId, batchName, batch.distributionSource?.trim() || null, quantity],
    );
    const batchRow = batchRows[0];

    // code ชนกับแคมเปญอื่นของร้าน (prefix เดิมที่ archive ไปแล้ว ฯลฯ) → 409 ชัด ๆ ไม่ใช่ 23505 หลุดเป็น 500
    const { rows: clash } = await client.query<{ public_code: string }>(
      `SELECT public_code FROM pos_vouchers WHERE user_id = $1 AND public_code = ANY($2::text[]) LIMIT 1`,
      [userId, codes],
    );
    if (clash[0]) throw new VoucherStateError("public_code_conflict");

    // INSERT ครั้งเดียวด้วย unnest — 1,000 ใบ = 1 statement
    let inserted: { id: string; public_code: string }[];
    try {
      ({ rows: inserted } = await client.query<{ id: string; public_code: string }>(
        `INSERT INTO pos_vouchers (user_id, campaign_id, batch_id, public_code, token_hash, status, activated_at)
         SELECT $1, $2, $5, c, h, 'active', now()
         FROM unnest($3::text[], $4::text[]) AS t(c, h)
         RETURNING id, public_code`,
        [userId, campaignId, codes, hashes, batchRow.id],
      ));
    } catch (e) {
      if (isUniqueViolation(e)) throw new VoucherStateError("public_code_conflict");
      throw e;
    }
    const idByCode = new Map(inserted.map((r) => [r.public_code, r.id]));
    for (const v of out) v.id = idByCode.get(v.publicCode) ?? "";

    await logVoucherEvent(client, userId, {
      campaignId, voucherId: null, actor: "owner", action: "generated",
      detail: { quantity, from: codes[0], to: codes[codes.length - 1], batchId: batchRow.id, batchName, source: batchRow.distribution_source },
    });
    await client.query("COMMIT");
    return { vouchers: out, batch: mapBatch(batchRow) };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ═══ voucher list / detail / actions ══════════════════════════════

type VoucherRow = {
  id: string;
  campaign_id: string;
  public_code: string;
  status: VoucherStatus;
  issued_at: Date | string;
  activated_at: Date | string | null;
  redeemed_at: Date | string | null;
  redeemed_bill_id: string | null;
  redeemed_bill_no: string | null;
  member_id: string | null;
  expires_at: Date | string;
  batch_id: string | null;
  batch_name: string | null;
  distribution_source: string | null;
};

function mapVoucher(r: VoucherRow): Voucher {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    publicCode: r.public_code,
    status: deriveVoucherStatus(r.status, r.expires_at),
    issuedAt: iso(r.issued_at),
    activatedAt: r.activated_at ? iso(r.activated_at) : null,
    redeemedAt: r.redeemed_at ? iso(r.redeemed_at) : null,
    redeemedBillId: r.redeemed_bill_id,
    redeemedBillNo: r.redeemed_bill_no,
    memberId: r.member_id,
    expiresAt: iso(r.expires_at),
    batchId: r.batch_id,
    batchName: r.batch_name,
    distributionSource: r.distribution_source,
  };
}

const VOUCHER_SELECT = `
  SELECT v.id, v.campaign_id, v.public_code, v.status, v.issued_at, v.activated_at,
         v.redeemed_at, v.redeemed_bill_id, v.member_id, c.expires_at,
         r.bill_no AS redeemed_bill_no,
         v.batch_id, b.name AS batch_name, b.distribution_source
  FROM pos_vouchers v
  JOIN pos_voucher_campaigns c ON c.id = v.campaign_id
  LEFT JOIN pos_voucher_redemptions r ON r.voucher_id = v.id
  LEFT JOIN pos_voucher_batches b ON b.id = v.batch_id`;

export async function listVouchers(
  userId: string,
  campaignId: string,
  opts: { status: string; q?: string; batchId?: string; source?: string; page: number; pageSize: number },
): Promise<{ items: Voucher[]; total: number; page: number; pageSize: number }> {
  const where: string[] = ["v.user_id = $1", "v.campaign_id = $2"];
  const params: unknown[] = [userId, campaignId];

  // filter สถานะ — 'expired' และ 'active' ต้องคิด expires_at ด้วย (ไม่มีใน DB)
  switch (opts.status) {
    case "active":
      where.push(`v.status IN ('active','issued') AND c.expires_at >= now()`);
      break;
    case "expired":
      where.push(`v.status IN ('active','issued') AND c.expires_at < now()`);
      break;
    case "all":
      break;
    default:
      params.push(opts.status);
      where.push(`v.status = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.toUpperCase()}%`);
    where.push(`upper(v.public_code) LIKE $${params.length}`);
  }
  if (opts.batchId) {
    params.push(opts.batchId);
    where.push(`v.batch_id = $${params.length}`);
  }
  if (opts.source) {
    params.push(opts.source);
    where.push(`b.distribution_source = $${params.length}`);
  }
  const whereSql = where.join(" AND ");

  const { rows: cnt } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pos_vouchers v
     JOIN pos_voucher_campaigns c ON c.id = v.campaign_id
     LEFT JOIN pos_voucher_batches b ON b.id = v.batch_id
     WHERE ${whereSql}`,
    params,
  );
  const offset = (opts.page - 1) * opts.pageSize;
  const { rows } = await pool.query<VoucherRow>(
    `${VOUCHER_SELECT} WHERE ${whereSql}
     ORDER BY v.public_code
     LIMIT ${opts.pageSize} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(mapVoucher), total: Number(cnt[0]?.n ?? 0), page: opts.page, pageSize: opts.pageSize };
}

export type VoucherDetail = Voucher & {
  campaignName: string;
  value: string;
  voucherType: string;
  redemption: {
    billNo: string | null;
    orderSubtotal: string;
    voucherAmount: string;
    finalTotal: string;
    redeemedAt: string;
    employeeName: string | null;
  } | null;
  events: { action: string; actor: string; at: string; detail: unknown }[];
};

export async function getVoucherDetail(userId: string, voucherId: string): Promise<VoucherDetail> {
  const { rows } = await pool.query<
    VoucherRow & { campaign_name: string; value: string; voucher_type: string }
  >(
    `${VOUCHER_SELECT.replace("SELECT v.id", "SELECT c.name AS campaign_name, c.value::text AS value, c.voucher_type, v.id")}
     WHERE v.user_id = $1 AND v.id = $2`,
    [userId, voucherId],
  );
  if (!rows[0]) throw new VoucherNotFoundError();
  const base = mapVoucher(rows[0]);

  const { rows: red } = await pool.query<{
    bill_no: string | null; order_subtotal: string; voucher_amount: string;
    final_total: string; redeemed_at: Date | string; employee_name: string | null;
  }>(
    `SELECT r.bill_no, r.order_subtotal::text, r.voucher_amount::text, r.final_total::text,
            r.redeemed_at, e.name AS employee_name
     FROM pos_voucher_redemptions r
     LEFT JOIN employees e ON e.id = r.employee_id
     WHERE r.user_id = $1 AND r.voucher_id = $2`,
    [userId, voucherId],
  );
  const { rows: ev } = await pool.query<{ action: string; actor: string; created_at: Date | string; detail: unknown }>(
    `SELECT action, actor, created_at, detail FROM pos_voucher_events
     WHERE user_id = $1 AND voucher_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [userId, voucherId],
  );
  return {
    ...base,
    campaignName: rows[0].campaign_name,
    value: rows[0].value,
    voucherType: rows[0].voucher_type,
    redemption: red[0]
      ? {
          billNo: red[0].bill_no,
          orderSubtotal: red[0].order_subtotal,
          voucherAmount: red[0].voucher_amount,
          finalTotal: red[0].final_total,
          redeemedAt: iso(red[0].redeemed_at),
          employeeName: red[0].employee_name,
        }
      : null,
    events: ev.map((e) => ({ action: e.action, actor: e.actor, at: iso(e.created_at), detail: e.detail })),
  };
}

/**
 * Block / Cancel — ทำได้เฉพาะใบที่ยังไม่ถูกใช้ · ห้าม redeemed → active (สเปกข้อ 16)
 * block = ระงับชั่วคราว (ปลดได้) · cancel = ถาวร
 */
export async function setVoucherStatus(
  userId: string,
  voucherId: string,
  next: "blocked" | "cancelled" | "active",
  reason: string | null,
): Promise<Voucher> {
  const allowedFrom =
    next === "active" ? ["blocked"] : ["active", "issued", "blocked"];
  const { rows } = await pool.query<{ id: string; campaign_id: string }>(
    `UPDATE pos_vouchers SET status = $3, updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status = ANY($4::text[])
     RETURNING id, campaign_id`,
    [userId, voucherId, next, allowedFrom],
  );
  if (!rows[0]) {
    // แยกว่า "ไม่มี" กับ "มีแต่เปลี่ยนไม่ได้" — อย่างหลังคือเคส redeemed → ห้ามเด็ดขาด
    const { rows: exists } = await pool.query<{ status: string }>(
      `SELECT status FROM pos_vouchers WHERE user_id = $1 AND id = $2`,
      [userId, voucherId],
    );
    if (!exists[0]) throw new VoucherNotFoundError();
    throw new VoucherStateError(`cannot_${next}_from_${exists[0].status}`);
  }
  await logVoucherEvent(pool, userId, {
    campaignId: rows[0].campaign_id, voucherId, actor: "owner",
    action: next === "active" ? "unblocked" : next, detail: reason ? { reason } : null,
  });
  const { rows: v } = await pool.query<VoucherRow>(
    `${VOUCHER_SELECT} WHERE v.user_id = $1 AND v.id = $2`,
    [userId, voucherId],
  );
  return mapVoucher(v[0]);
}

/**
 * ออกลิงก์ใหม่ — เจ้าของทำ token หาย (raw คืนครั้งเดียว) · ใบเดิมยังเป็นใบเดิม
 * ลิงก์/QR เก่าใช้ไม่ได้ทันที · ต้องเป็นใบที่ยังไม่ใช้
 */
export async function reissueVoucherToken(
  userId: string,
  voucherId: string,
  posAppBaseUrl: string,
): Promise<GeneratedVoucher> {
  const token = generateVoucherToken();
  const { rows } = await pool.query<{ id: string; public_code: string; campaign_id: string }>(
    `UPDATE pos_vouchers SET token_hash = $3, updated_at = now()
     WHERE user_id = $1 AND id = $2 AND status IN ('active','issued','blocked')
     RETURNING id, public_code, campaign_id`,
    [userId, voucherId, hashVoucherToken(token)],
  );
  if (!rows[0]) throw new VoucherStateError("cannot_reissue");
  await logVoucherEvent(pool, userId, {
    campaignId: rows[0].campaign_id, voucherId, actor: "owner", action: "token_reissued", detail: null,
  });
  return { id: rows[0].id, publicCode: rows[0].public_code, token, url: voucherCardUrl(posAppBaseUrl, token) };
}

// ═══ public card ══════════════════════════════════════════════════

/** ข้อมูลที่หน้า /v/[token] เห็น — ไม่มี id ภายใน, hash, member, metadata */
export type PublicVoucherCard = {
  /** @deprecated ใช้ merchant.name — คงไว้ให้ client เก่าอ่านได้ */
  brandName: string;
  /** Merchant identity ที่ resolve แล้ว (โปรไฟล์ร้าน → campaign override) */
  merchant: { name: string; logoUrl: string | null };
  campaignName: string;
  /** คำอธิบายสั้น ๆ ของแคมเปญ — บรรทัดใต้มูลค่า */
  description: string | null;
  sponsor: string | null;
  voucherType: string;
  value: string;
  /** เงื่อนไข (V2) — การ์ดพิมพ์ "ขั้นต่ำ ฿100 · ลดสูงสุด ฿50" */
  minimumSpend: string;
  maximumDiscount: string | null;
  publicCode: string;
  status: VoucherStatus;
  expiresAt: string;
  startAt: string;
  redeemedAt: string | null;
  terms: string | null;
  /** สี/ template ที่ resolve แล้ว — client ไม่ต้องรู้ว่ามาจากร้านหรือแคมเปญ */
  design: {
    template: VoucherDesignConfig["template"];
    primaryColor: string;
    backgroundColor: string;
    heroImageUrl: string | null;
    showSponsor: boolean;
  };
};

export async function getPublicVoucherCard(scan: string): Promise<PublicVoucherCard | null> {
  const token = parseVoucherToken(scan);
  if (!token) return null;
  const { rows } = await pool.query<{
    user_id: string; shop_name: string; campaign_name: string; description: string | null;
    sponsor: string | null;
    voucher_type: string; value: string; public_code: string; status: VoucherStatus;
    expires_at: Date | string; start_at: Date | string; redeemed_at: Date | string | null;
    terms: string | null; design_config: unknown; campaign_status: string; voucher_id: string; campaign_id: string;
    brand_logo_url: string | null; brand_primary_color: string | null; brand_secondary_color: string | null;
    minimum_spend: string | null; maximum_discount: string | null;
  }>(
    `SELECT v.user_id, u.shop_name, c.name AS campaign_name, c.description, c.sponsor, c.voucher_type,
            c.value::text AS value, c.minimum_spend::text AS minimum_spend, c.maximum_discount::text AS maximum_discount,
            v.public_code, v.status, c.expires_at, c.start_at,
            v.redeemed_at, c.terms, c.design_config, c.status AS campaign_status,
            v.id AS voucher_id, c.id AS campaign_id,
            s.brand_logo_url, s.brand_primary_color, s.brand_secondary_color
     FROM pos_vouchers v
     JOIN pos_voucher_campaigns c ON c.id = v.campaign_id
     JOIN users u ON u.id = v.user_id
     LEFT JOIN pos_shop_settings s ON s.user_id = v.user_id
     WHERE v.token_hash = $1`,
    [hashVoucherToken(token)],
  );
  const r = rows[0];
  if (!r) return null;
  const design = designConfigSchema.safeParse(r.design_config ?? {});
  const d = design.success ? design.data : designConfigSchema.parse({});
  // แคมเปญไม่ active (draft/paused/ended/archived) = การ์ดใช้ไม่ได้ → blocked
  // ให้ตรงกับที่ POS จะตอบ (CAMPAIGN_INACTIVE) ไม่เผยเหตุผลภายใน · ใบที่ใช้แล้วยังโชว์ redeemed
  const status =
    r.campaign_status !== "active" && r.status !== "redeemed"
      ? "blocked"
      : deriveVoucherStatus(r.status, r.expires_at);
  // view log: ไม่ await (ไม่ทำให้หน้าช้า) + dedupe 10 นาที/ใบ — กัน public flood ทำตาราง events บวม
  void pool
    .query(
      `INSERT INTO pos_voucher_events (user_id, campaign_id, voucher_id, actor, action, detail)
       SELECT $1, $2, $3, 'public', 'viewed', NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM pos_voucher_events
         WHERE voucher_id = $3 AND action = 'viewed'
           AND created_at > now() - interval '10 minutes')`,
      [r.user_id, r.campaign_id, r.voucher_id],
    )
    .catch(() => undefined);
  const brand: ResolvedCardBrand = resolveCardBrand(d, {
    name: r.shop_name,
    logoUrl: r.brand_logo_url,
    primaryColor: r.brand_primary_color,
    secondaryColor: r.brand_secondary_color,
  });
  return {
    brandName: brand.merchantName,
    merchant: { name: brand.merchantName, logoUrl: brand.logoUrl },
    campaignName: r.campaign_name,
    description: r.description,
    sponsor: d.showSponsor ? r.sponsor : null,
    voucherType: r.voucher_type,
    value: r.value,
    minimumSpend: r.minimum_spend ?? "0.00",
    maximumDiscount: r.maximum_discount,
    publicCode: r.public_code,
    status,
    expiresAt: iso(r.expires_at),
    startAt: iso(r.start_at),
    redeemedAt: r.redeemed_at ? iso(r.redeemed_at) : null,
    terms: r.terms,
    design: {
      template: d.template,
      primaryColor: brand.primaryColor,
      backgroundColor: brand.backgroundColor,
      heroImageUrl: d.heroImageUrl ?? null,
      showSponsor: d.showSponsor,
    },
  };
}

// ═══ validate + redeem (POS) ══════════════════════════════════════

type LockedVoucherRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  public_code: string;
  status: VoucherStatus;
  redeemed_at: Date | string | null;
  campaign_name: string;
  campaign_status: VoucherCampaignStatus;
  voucher_type: string;
  value: string;
  start_at: Date | string;
  expires_at: Date | string;
  allowed_branch_ids: string[] | null;
  bill_no: string | null;
  minimum_spend: string | null;
  maximum_discount: string | null;
  batch_id: string | null;
};

/**
 * ข้อมูล voucher ที่ POS ต้องเห็นก่อน apply — type-aware
 * V2.1: mode 'secure' (มี id ใบ) | 'manual' (ไม่มีใบ · มี range + code) — closePosBill ใช้ redeemAppliedVoucherInTx เดียว
 */
export type ValidatedVoucher = {
  mode: "secure" | "manual";
  /** secure = id ใบ · manual = null (ไม่มีแถวใบ) */
  id: string | null;
  campaignId: string;
  batchId: string | null;
  /** manual เท่านั้น */
  manualRangeId: string | null;
  manualCode: string | null;
  publicCode: string;
  campaignName: string;
  voucherType: string;
  value: string;
  minimumSpend: string;
  maximumDiscount: string | null;
  expiresAt: string;
};

type RuleSource = {
  campaignId: string;
  campaignName: string;
  voucherType: string;
  value: string;
  minimumSpend: string | null;
  maximumDiscount: string | null;
};

/**
 * rule สังเคราะห์ → engine เดิมจัดสรรรายบรรทัด + cap ≤ ยอด eligible (ไม่มีทางติดลบ)
 * ใช้ร่วม secure/manual — สูตรเดียว การ์ดสองแบบ
 */
function evaluateVoucherRule(
  v: RuleSource,
  lines: EngineLine[],
  now: Date,
  reject: (reason: VoucherRejectReason, info?: Record<string, string | null>) => PosVoucherRejectedError,
): CampaignEvaluation & { valid: true } {
  const rule: CampaignRule = {
    id: v.campaignId,
    name: v.campaignName,
    code: null,
    status: "active",
    // gift (fixed_amount) และ fixed_discount ใช้ discountType 'fixed' เหมือนกันใน engine —
    // ความต่างคือความหมายทางธุรกิจ (เก็บ voucher_type snapshot ลง redemption) ไม่ใช่สูตร
    discountType: v.voucherType === "percentage" ? "percentage" : "fixed",
    discountValue: v.value,
    scope: "entire_order",
    productIds: [],
    minimumOrderAmount: v.minimumSpend ?? "0",
    maximumDiscountAmount: v.voucherType === "percentage" ? v.maximumDiscount : null,
    usageLimit: null,
    usageLimitPerCustomer: null,
    usedCount: 0,
    startAt: null,
    endAt: null,
    timeStartMin: null,
    timeEndMin: null,
    daysOfWeek: null,
    eligibility: "all",
  };
  const evaluation = evaluateCampaign({ campaign: rule, lines, customerUsedCount: null, hasMember: false, now });
  if (!evaluation.valid) {
    if (evaluation.reason === "MINIMUM_ORDER_NOT_REACHED") {
      // POS ต้องบอกได้ว่า "ต้องเพิ่มอีกเท่าไร" — ไม่ใช่ generic error (สเปก V2 §20)
      const currentCents = lines.reduce((a, l) => a + l.lineTotalCents, 0);
      const minCents = toCents(v.minimumSpend ?? "0");
      throw reject("MINIMUM_SPEND_NOT_REACHED", {
        minimumSpend: centsToDecimalString(minCents),
        currentSubtotal: centsToDecimalString(currentCents),
        shortfall: centsToDecimalString(Math.max(0, minCents - currentCents)),
      });
    }
    throw reject(evaluation.reason === "NO_ELIGIBLE_ITEMS" ? "NO_ELIGIBLE_ITEMS" : "UNSUPPORTED_VOUCHER_TYPE");
  }
  return evaluation;
}

/**
 * ตรวจ voucher สำหรับตะกร้านี้ — ใช้ทั้งจาก /validate (read-only, client=pool)
 * และจากใน closePosBill (client ใน transaction → FOR UPDATE)
 *
 * ลำดับตรวจตายตัว (สเปก §5): business → campaign → status → start → expiry → branch → redemption
 */
export async function validateVoucherForCart(args: {
  userId: string;
  scan: string;
  lines: EngineLine[];
  client?: PoolClient;
  now?: Date;
  /** ตะกร้าว่าง (POS สแกนก่อนหยิบของ) — ตรวจแค่สถานะใบ ไม่คิดส่วนลด/ยอดขั้นต่ำ · closePosBill ห้ามใช้ */
  statusOnly?: boolean;
}): Promise<{
  voucher: ValidatedVoucher;
  /** null เมื่อ statusOnly */
  evaluation: (CampaignEvaluation & { valid: true }) | null;
}> {
  const c = db(args.client);
  const now = args.now ?? new Date();
  const token = parseVoucherToken(args.scan);
  if (!token) {
    // ไม่ใช่ secure token → ลองเป็น Manual Code (V2.1) · ไม่ใช่ทั้งคู่ = ไม่พบ
    const manual = parseManualCode(args.scan);
    if (!manual) throw new PosVoucherRejectedError("VOUCHER_NOT_FOUND");
    return validateManualCodeForCart({ ...args, code: manual.raw, now });
  }

  const { rows } = await c.query<LockedVoucherRow>(
    `SELECT v.id, v.user_id, v.campaign_id, v.public_code, v.status, v.redeemed_at,
            c.name AS campaign_name, c.status AS campaign_status, c.voucher_type,
            c.value::text AS value, c.start_at, c.expires_at, c.allowed_branch_ids,
            r.bill_no, c.minimum_spend::text AS minimum_spend, c.maximum_discount::text AS maximum_discount,
            v.batch_id
     FROM pos_vouchers v
     JOIN pos_voucher_campaigns c ON c.id = v.campaign_id
     LEFT JOIN pos_voucher_redemptions r ON r.voucher_id = v.id
     WHERE v.token_hash = $1
     ${args.client ? "FOR UPDATE OF v" : ""}`,
    [hashVoucherToken(token)],
  );
  const v = rows[0];
  if (!v) throw new PosVoucherRejectedError("VOUCHER_NOT_FOUND");
  // token ถูกต้องแต่เป็นของร้านอื่น — บอกได้ว่า "ใช้ที่ร้านนี้ไม่ได้" โดยไม่เผยว่าร้านไหน
  // (ไม่แนบ id ของร้านอื่นลง audit ของร้านนี้)
  if (v.user_id !== args.userId) throw new PosVoucherRejectedError("WRONG_BUSINESS");

  const ids = { voucherId: v.id, campaignId: v.campaign_id };
  const reject = (reason: VoucherRejectReason, info: Record<string, string | null> = {}) =>
    new PosVoucherRejectedError(reason, info, ids);

  if (v.campaign_status !== "active") throw reject("CAMPAIGN_INACTIVE");

  switch (v.status) {
    case "redeemed":
      throw reject("VOUCHER_ALREADY_REDEEMED", {
        redeemedAt: v.redeemed_at ? iso(v.redeemed_at) : null,
        billNo: v.bill_no,
      });
    case "blocked":
      throw reject("VOUCHER_BLOCKED");
    case "cancelled":
      throw reject("VOUCHER_CANCELLED");
    case "expired":
      throw reject("VOUCHER_EXPIRED");
    case "issued":
      throw reject("VOUCHER_NOT_ACTIVE");
    case "active":
      break;
  }
  if (now < new Date(v.start_at)) throw reject("VOUCHER_NOT_STARTED");
  if (now > new Date(v.expires_at)) throw reject("VOUCHER_EXPIRED");
  // BLOCKER-2 A: allowed_branch_ids เก็บไว้แต่ยังไม่บังคับ — POS ไม่มี branch context
  // (เมื่อมี: if (v.allowed_branch_ids && !v.allowed_branch_ids.includes(branchId)) → WRONG_BRANCH)

  if (!REDEEMABLE_VOUCHER_TYPES.includes(v.voucher_type as VoucherType)) {
    throw reject("UNSUPPORTED_VOUCHER_TYPE");
  }

  const validated: ValidatedVoucher = {
    mode: "secure", id: v.id, campaignId: v.campaign_id, batchId: v.batch_id,
    manualRangeId: null, manualCode: null, publicCode: v.public_code,
    campaignName: v.campaign_name, voucherType: v.voucher_type, value: v.value,
    minimumSpend: v.minimum_spend ?? "0.00", maximumDiscount: v.maximum_discount,
    expiresAt: iso(v.expires_at),
  };
  if (args.statusOnly) return { voucher: validated, evaluation: null };

  const evaluation = evaluateVoucherRule(
    { campaignId: v.campaign_id, campaignName: v.campaign_name, voucherType: v.voucher_type, value: v.value, minimumSpend: v.minimum_spend, maximumDiscount: v.maximum_discount },
    args.lines, now, reject,
  );
  return { voucher: validated, evaluation };
}

// ═══ Manual Code (V2.1) — resolve / validate / redeem ═════════════

type ManualRangeRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  kind: "range" | "custom";
  prefix: string | null;
  start_number: number | null;
  end_number: number | null;
  padding: number | null;
  custom_code: string | null;
  name: string;
  distribution_source: string | null;
  status: "active" | "paused" | "archived";
  created_at: Date | string;
};

type ResolvedManualRow = ManualRangeRow & {
  campaign_name: string;
  campaign_status: VoucherCampaignStatus;
  generation_mode: string | null;
  voucher_type: string;
  value: string;
  minimum_spend: string | null;
  maximum_discount: string | null;
  start_at: Date | string;
  expires_at: Date | string;
};

/**
 * code ที่ POS กรอก → range ของร้านนี้ (scope user_id เสมอ → code ร้านอื่น = ไม่พบ · ไม่เผยว่ามี)
 *   range   PREFIX-0042 → แคมเปญที่ code_prefix = PREFIX (unique ต่อร้าน) → range ที่ครอบเลข 42
 *   custom  VIP-2026   → range kind=custom ที่ custom_code ตรง
 * คืน canonical code (padding ตาม range) — เก็บลง redemption ให้ UNIQUE ทำงานไม่ว่าพนักงานพิมพ์ 42 หรือ 0042
 */
async function resolveManualCode(
  c: Q,
  userId: string,
  rawCode: string,
): Promise<{ row: ResolvedManualRow; code: string } | null> {
  const parsed = parseManualCode(rawCode);
  if (!parsed) return null;
  const SELECT = `
    SELECT r.*, c.name AS campaign_name, c.status AS campaign_status, c.generation_mode, c.voucher_type,
           c.value::text AS value, c.minimum_spend::text AS minimum_spend, c.maximum_discount::text AS maximum_discount,
           c.start_at, c.expires_at
    FROM pos_voucher_manual_ranges r
    JOIN pos_voucher_campaigns c ON c.id = r.campaign_id
    WHERE r.user_id = $1`;
  if (parsed.kind === "custom") {
    const { rows } = await c.query<ResolvedManualRow>(`${SELECT} AND r.kind = 'custom' AND r.custom_code = $2`, [userId, parsed.code]);
    return rows[0] ? { row: rows[0], code: parsed.code } : null;
  }
  const { rows } = await c.query<ResolvedManualRow>(
    `${SELECT} AND r.kind = 'range' AND r.prefix = $2 AND $3 BETWEEN r.start_number AND r.end_number
     ORDER BY r.created_at ASC LIMIT 1`,
    [userId, parsed.prefix, parsed.number],
  );
  const row = rows[0];
  if (!row) return null;
  return { row, code: formatManualCode(row.prefix!, parsed.number, row.padding ?? 4) };
}

/**
 * ตรวจ Manual Code สำหรับตะกร้านี้ — ลำดับเดียวกับ secure: found → campaign → range status → start → expiry → type → redeemed → rule
 * ใน closePosBill (มี client) ล็อกด้วย advisory lock ต่อ (range, code) → POS 2 เครื่องยิง code เดียวกัน
 * เครื่องที่สองรอแล้วเห็น redemption ของเครื่องแรก → VOUCHER_ALREADY_REDEEMED สะอาด ๆ · UNIQUE index เป็นชั้นสุดท้าย
 */
export async function validateManualCodeForCart(args: {
  userId: string;
  code: string;
  lines: EngineLine[];
  client?: PoolClient;
  now?: Date;
  statusOnly?: boolean;
}): Promise<{ voucher: ValidatedVoucher; evaluation: (CampaignEvaluation & { valid: true }) | null }> {
  const c = db(args.client);
  const now = args.now ?? new Date();
  const resolved = await resolveManualCode(c, args.userId, args.code);
  if (!resolved) throw new PosVoucherRejectedError("VOUCHER_NOT_FOUND");
  const { row, code } = resolved;
  const ids = { voucherId: null, campaignId: row.campaign_id };
  const reject = (reason: VoucherRejectReason, info: Record<string, string | null> = {}) =>
    new PosVoucherRejectedError(reason, { ...info, manualCode: code }, ids);

  if (row.generation_mode !== "manual_range" || row.campaign_status !== "active") throw reject("CAMPAIGN_INACTIVE");
  if (row.status === "paused") throw reject("VOUCHER_BLOCKED");
  if (row.status === "archived") throw reject("VOUCHER_CANCELLED");
  if (now < new Date(row.start_at)) throw reject("VOUCHER_NOT_STARTED");
  if (now > new Date(row.expires_at)) throw reject("VOUCHER_EXPIRED");
  if (!MANUAL_ALLOWED_VOUCHER_TYPES.includes(row.voucher_type as VoucherType)) throw reject("UNSUPPORTED_VOUCHER_TYPE");

  if (args.client) {
    // serialize ต่อ code — hashtext 2 ตัว (range id, code) → int8 lock key · ปล่อยเองตอน COMMIT/ROLLBACK
    await args.client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [row.id, code]);
  }
  const { rows: used } = await c.query<{ redeemed_at: Date | string; bill_no: string | null }>(
    `SELECT redeemed_at, bill_no FROM pos_voucher_redemptions WHERE manual_range_id = $1 AND manual_code = $2`,
    [row.id, code],
  );
  if (used[0]) throw reject("VOUCHER_ALREADY_REDEEMED", { redeemedAt: iso(used[0].redeemed_at), billNo: used[0].bill_no });

  const validated: ValidatedVoucher = {
    mode: "manual", id: null, campaignId: row.campaign_id, batchId: null,
    manualRangeId: row.id, manualCode: code, publicCode: code,
    campaignName: row.campaign_name, voucherType: row.voucher_type, value: row.value,
    minimumSpend: row.minimum_spend ?? "0.00", maximumDiscount: row.maximum_discount,
    expiresAt: iso(row.expires_at),
  };
  if (args.statusOnly) return { voucher: validated, evaluation: null };
  const evaluation = evaluateVoucherRule(
    { campaignId: row.campaign_id, campaignName: row.campaign_name, voucherType: row.voucher_type, value: row.value, minimumSpend: row.minimum_spend, maximumDiscount: row.maximum_discount },
    args.lines, now, reject,
  );
  return { voucher: validated, evaluation };
}

/**
 * ⭐ Manual redeem — ใน transaction เดียวกับบิล (closePosBill) · ไม่มีแถวใบให้ UPDATE
 * แถว redemption คือ "สถานะใช้แล้ว" ตัวเดียว: INSERT ชน UNIQUE(range, code) = มีคนใช้ตัดหน้า → reject ทั้ง transaction
 * (advisory lock ใน validate ทำให้เคสปกติไม่ถึงตรงนี้ — นี่คือชั้นสุดท้าย)
 */
export async function redeemManualCodeInTx(
  client: PoolClient,
  userId: string,
  args: {
    manualRangeId: string;
    manualCode: string;
    campaignId: string;
    voucherType: string;
    billId: string;
    billNo: string;
    employeeId: string | null;
    orderSubtotal: string;
    voucherFaceValue: string;
    voucherAmount: string;
    finalTotal: string;
  },
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO pos_voucher_redemptions
         (user_id, voucher_id, campaign_id, bill_id, bill_no, employee_id,
          order_subtotal, voucher_face_value, voucher_amount, final_total, voucher_type, batch_id,
          redemption_mode, manual_range_id, manual_code)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, 'manual', $11, $12)`,
      [
        userId, args.campaignId, args.billId, args.billNo, args.employeeId,
        args.orderSubtotal, args.voucherFaceValue, args.voucherAmount, args.finalTotal,
        args.voucherType, args.manualRangeId, args.manualCode,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e, "idx_pos_voucher_redemptions_manual_code")) {
      throw new PosVoucherRejectedError("VOUCHER_ALREADY_REDEEMED", { manualCode: args.manualCode }, { voucherId: null, campaignId: args.campaignId });
    }
    throw e;
  }
  await logVoucherEvent(client, userId, {
    campaignId: args.campaignId, voucherId: null,
    actor: args.employeeId ? "staff" : "owner", action: "redeemed",
    detail: { billNo: args.billNo, amount: args.voucherAmount, type: args.voucherType, mode: "manual", code: args.manualCode, rangeId: args.manualRangeId },
  });
}

/** จุดเรียกเดียวจาก closePosBill — แยก secure/manual ที่นี่ ไม่ให้ closePosBill รู้จักโครงสร้างสองแบบ */
export async function redeemAppliedVoucherInTx(
  client: PoolClient,
  userId: string,
  args: {
    voucher: ValidatedVoucher;
    billId: string;
    billNo: string;
    employeeId: string | null;
    orderSubtotal: string;
    voucherAmount: string;
    finalTotal: string;
  },
): Promise<void> {
  const v = args.voucher;
  const common = {
    campaignId: v.campaignId, voucherType: v.voucherType, billId: args.billId, billNo: args.billNo,
    employeeId: args.employeeId, orderSubtotal: args.orderSubtotal, voucherFaceValue: v.value,
    voucherAmount: args.voucherAmount, finalTotal: args.finalTotal,
  };
  if (v.mode === "manual") {
    if (!v.manualRangeId || !v.manualCode) throw new PosVoucherRejectedError("VOUCHER_NOT_FOUND");
    return redeemManualCodeInTx(client, userId, { ...common, manualRangeId: v.manualRangeId, manualCode: v.manualCode });
  }
  if (!v.id) throw new PosVoucherRejectedError("VOUCHER_NOT_FOUND");
  return redeemVoucherInTx(client, userId, { ...common, voucherId: v.id, batchId: v.batchId });
}

// ═══ Manual ranges — CRUD ═════════════════════════════════════════

export type ManualRange = {
  id: string;
  campaignId: string;
  kind: "range" | "custom";
  prefix: string | null;
  startNumber: number | null;
  endNumber: number | null;
  padding: number | null;
  customCode: string | null;
  name: string;
  distributionSource: string | null;
  status: "active" | "paused" | "archived";
  createdAt: string;
  /** derive: จำนวน code ในช่วง (custom = 1) */
  configured: number;
  /** จาก redemptions จริง */
  redeemed: number;
  remaining: number;
  discountGiven: string;
  revenueFromRedeemedOrders: string;
  /** code แรก/สุดท้ายสำหรับโชว์ (client derive ที่เหลือเอง) */
  firstCode: string;
  lastCode: string;
};

type ManualRangeStatRow = ManualRangeRow & { n_redeemed: string; discount_given: string; revenue: string };

function mapManualRange(r: ManualRangeStatRow): ManualRange {
  const configured = r.kind === "range" ? manualRangeSize(Number(r.start_number), Number(r.end_number)) : 1;
  const redeemed = int(r.n_redeemed);
  const money = (v: string | null) => (v == null ? "0.00" : centsToDecimalString(toCents(v)));
  const first = r.kind === "range" ? formatManualCode(r.prefix!, Number(r.start_number), Number(r.padding)) : r.custom_code!;
  const last = r.kind === "range" ? formatManualCode(r.prefix!, Number(r.end_number), Number(r.padding)) : r.custom_code!;
  return {
    id: r.id, campaignId: r.campaign_id, kind: r.kind, prefix: r.prefix,
    startNumber: r.start_number == null ? null : Number(r.start_number),
    endNumber: r.end_number == null ? null : Number(r.end_number),
    padding: r.padding == null ? null : Number(r.padding),
    customCode: r.custom_code, name: r.name, distributionSource: r.distribution_source, status: r.status,
    createdAt: iso(r.created_at), configured, redeemed, remaining: Math.max(0, configured - redeemed),
    discountGiven: money(r.discount_given), revenueFromRedeemedOrders: money(r.revenue),
    firstCode: first, lastCode: last,
  };
}

const MANUAL_RANGE_SELECT = `
  SELECT r.*, COALESCE(s.n, 0)::text AS n_redeemed, COALESCE(s.discount_given, 0)::text AS discount_given,
         COALESCE(s.revenue, 0)::text AS revenue
  FROM pos_voucher_manual_ranges r
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, SUM(voucher_amount) AS discount_given, SUM(order_subtotal) AS revenue
    FROM pos_voucher_redemptions rd WHERE rd.manual_range_id = r.id
  ) s ON true`;

export async function listManualRanges(userId: string, campaignId: string): Promise<ManualRange[]> {
  await getVoucherCampaign(userId, campaignId); // tenant guard → 404
  const { rows } = await pool.query<ManualRangeStatRow>(
    `${MANUAL_RANGE_SELECT} WHERE r.user_id = $1 AND r.campaign_id = $2 ORDER BY r.created_at ASC`,
    [userId, campaignId],
  );
  return rows.map(mapManualRange);
}

/**
 * เพิ่มช่วง/custom code ให้แคมเปญ Manual — O(1) แถว ไม่ว่าจะ 10 หรือ 100,000 code
 * กติกา (ทั้งหมดใน transaction + ล็อกแคมเปญ):
 *   · แคมเปญต้องเป็น manual_range · ไม่ archived/ended · type ต้อง percentage/fixed_discount
 *   · range: prefix = code_prefix ของแคมเปญเสมอ · padding ต้องเท่ากับ range เดิมในแคมเปญ (ไม่งั้น 0042/042 กำกวม)
 *     ช่วงเลขห้ามซ้อนกับ range เดิม (รวม paused/archived — code เก่าอาจยังลอยอยู่)
 *   · custom: normalize → ต้องผ่าน isValidCustomCode (ห้ามรูป PREFIX-ตัวเลข) → unique ต่อร้าน (index)
 *     และห้ามชนกับ public_code ของใบ secure ในร้าน
 */
export async function createManualRange(
  userId: string,
  campaignId: string,
  input: ManualRangeCreateInput,
): Promise<ManualRange> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: camp } = await client.query<{ code_prefix: string; status: string; generation_mode: string | null; voucher_type: string }>(
      `SELECT code_prefix, status, generation_mode, voucher_type FROM pos_voucher_campaigns
       WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, campaignId],
    );
    if (!camp[0]) throw new VoucherCampaignNotFoundError();
    if (camp[0].generation_mode !== "manual_range") throw new VoucherStateError("secure_campaign");
    if (camp[0].status === "archived" || camp[0].status === "ended") throw new VoucherStateError("campaign_closed");
    if (!MANUAL_ALLOWED_VOUCHER_TYPES.includes(camp[0].voucher_type as VoucherType)) throw new VoucherStateError("manual_type_not_allowed");

    const { rows: existing } = await client.query<ManualRangeRow>(
      `SELECT * FROM pos_voucher_manual_ranges WHERE campaign_id = $1`,
      [campaignId],
    );
    const { rows: nb } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pos_voucher_manual_ranges WHERE campaign_id = $1`, [campaignId],
    );
    const defaultName = `Codes #${Number(nb[0]?.n ?? 0) + 1}`;

    let inserted: ManualRangeRow;
    if (input.kind === "range") {
      const prefix = camp[0].code_prefix;
      const check = checkManualRangeInput({ prefix, startNumber: input.startNumber, endNumber: input.endNumber, padding: input.padding });
      if (!check.ok) throw new VoucherStateError("invalid_range");
      const ranges = existing.filter((r) => r.kind === "range");
      if (ranges.length && ranges.some((r) => Number(r.padding) !== input.padding)) throw new VoucherStateError("padding_mismatch");
      if (ranges.some((r) => manualRangesOverlap(
        { startNumber: Number(r.start_number), endNumber: Number(r.end_number) },
        { startNumber: input.startNumber, endNumber: input.endNumber },
      ))) throw new VoucherStateError("range_overlap");
      const { rows } = await client.query<ManualRangeRow>(
        `INSERT INTO pos_voucher_manual_ranges
           (user_id, campaign_id, kind, prefix, start_number, end_number, padding, name, distribution_source)
         VALUES ($1, $2, 'range', $3, $4, $5, $6, $7, $8) RETURNING *`,
        [userId, campaignId, prefix, input.startNumber, input.endNumber, input.padding,
          input.name?.trim() || defaultName, input.distributionSource?.trim() || null],
      );
      inserted = rows[0];
    } else {
      const code = normalizeManualCode(input.code);
      if (!isValidCustomCode(code)) throw new VoucherStateError("invalid_custom_code");
      const { rows: clash } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pos_vouchers WHERE user_id = $1 AND public_code = $2`, [userId, code],
      );
      if (Number(clash[0]?.n ?? 0) > 0) throw new VoucherStateError("custom_code_in_use");
      try {
        const { rows } = await client.query<ManualRangeRow>(
          `INSERT INTO pos_voucher_manual_ranges
             (user_id, campaign_id, kind, custom_code, name, distribution_source)
           VALUES ($1, $2, 'custom', $3, $4, $5) RETURNING *`,
          [userId, campaignId, code, input.name?.trim() || code, input.distributionSource?.trim() || null],
        );
        inserted = rows[0];
      } catch (e) {
        if (isUniqueViolation(e, "idx_pos_voucher_manual_ranges_custom")) throw new VoucherStateError("custom_code_in_use");
        throw e;
      }
    }
    await logVoucherEvent(client, userId, {
      campaignId, voucherId: null, actor: "owner", action: "manual_range_created",
      detail: input.kind === "range"
        ? { rangeId: inserted.id, prefix: inserted.prefix, from: inserted.start_number, to: inserted.end_number, padding: inserted.padding, source: inserted.distribution_source }
        : { rangeId: inserted.id, customCode: inserted.custom_code, source: inserted.distribution_source },
    });
    await client.query("COMMIT");
    return mapManualRange({ ...inserted, n_redeemed: "0", discount_given: "0", revenue: "0" });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** active ↔ paused · archived = ปลายทาง (code ทั้งช่วงใช้ไม่ได้ · ประวัติ redemption อยู่ครบ) */
export async function setManualRangeStatus(
  userId: string,
  campaignId: string,
  rangeId: string,
  status: "active" | "paused" | "archived",
): Promise<ManualRange> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM pos_voucher_manual_ranges WHERE user_id = $1 AND campaign_id = $2 AND id = $3`,
    [userId, campaignId, rangeId],
  );
  if (!rows[0]) throw new VoucherNotFoundError();
  if (rows[0].status === "archived") throw new VoucherStateError("range_archived");
  await pool.query(
    `UPDATE pos_voucher_manual_ranges SET status = $4, updated_at = now()
     WHERE user_id = $1 AND campaign_id = $2 AND id = $3`,
    [userId, campaignId, rangeId, status],
  );
  await logVoucherEvent(pool, userId, {
    campaignId, voucherId: null, actor: "owner", action: "manual_range_status", detail: { rangeId, status },
  });
  const { rows: out } = await pool.query<ManualRangeStatRow>(
    `${MANUAL_RANGE_SELECT} WHERE r.user_id = $1 AND r.id = $2`, [userId, rangeId],
  );
  return mapManualRange(out[0]);
}

export type ManualRedemption = {
  id: string;
  rangeId: string;
  code: string;
  billNo: string | null;
  orderSubtotal: string;
  voucherAmount: string;
  finalTotal: string;
  redeemedAt: string;
};

/** code ที่ใช้แล้วของแคมเปญ Manual (หน้า detail) — ไม่มี "รายการ code ทั้งหมด" เพราะไม่มีแถว · client derive เอง */
export async function listManualRedemptions(
  userId: string,
  campaignId: string,
  opts: { rangeId?: string; page: number; pageSize: number },
): Promise<{ items: ManualRedemption[]; total: number; page: number; pageSize: number }> {
  await getVoucherCampaign(userId, campaignId);
  const params: unknown[] = [userId, campaignId];
  let where = `rd.user_id = $1 AND rd.campaign_id = $2 AND rd.redemption_mode = 'manual'`;
  if (opts.rangeId) {
    params.push(opts.rangeId);
    where += ` AND rd.manual_range_id = $${params.length}`;
  }
  const { rows: cnt } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pos_voucher_redemptions rd WHERE ${where}`, params);
  const { rows } = await pool.query<{
    id: string; manual_range_id: string; manual_code: string; bill_no: string | null;
    order_subtotal: string; voucher_amount: string; final_total: string; redeemed_at: Date | string;
  }>(
    `SELECT rd.id, rd.manual_range_id, rd.manual_code, rd.bill_no, rd.order_subtotal::text, rd.voucher_amount::text,
            rd.final_total::text, rd.redeemed_at
     FROM pos_voucher_redemptions rd WHERE ${where}
     ORDER BY rd.redeemed_at DESC LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id, rangeId: r.manual_range_id, code: r.manual_code, billNo: r.bill_no,
      orderSubtotal: r.order_subtotal, voucherAmount: r.voucher_amount, finalTotal: r.final_total, redeemedAt: iso(r.redeemed_at),
    })),
    total: Number(cnt[0]?.n ?? 0), page: opts.page, pageSize: opts.pageSize,
  };
}

/**
 * ⭐ ต้องอยู่ใน transaction เดียวกับบิล — เรียกหลัง INSERT pos_bills
 *
 * 1) atomic UPDATE … WHERE status='active' — 0 rows = มีคนใช้ตัดหน้า → reject ทั้ง transaction
 * 2) INSERT redemptions — UNIQUE(voucher_id) เป็นชั้นที่สอง (ถ้า (1) หลุดยังชนที่นี่)
 * 3) event
 */
export async function redeemVoucherInTx(
  client: PoolClient,
  userId: string,
  args: {
    voucherId: string;
    campaignId: string;
    /** snapshot สำหรับ analytics ต่อ batch/ช่องทาง */
    batchId: string | null;
    /** snapshot ประเภท — analytics/บัญชีไม่ต้อง join ย้อน */
    voucherType: string;
    billId: string;
    billNo: string;
    employeeId: string | null;
    orderSubtotal: string;
    voucherFaceValue: string;
    voucherAmount: string;
    finalTotal: string;
  },
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE pos_vouchers
     SET status = 'redeemed', redeemed_at = now(), redeemed_bill_id = $3, updated_at = now()
     WHERE id = $2 AND user_id = $1 AND status = 'active'
     RETURNING id`,
    [userId, args.voucherId, args.billId],
  );
  if (!rows[0]) throw new PosVoucherRejectedError("VOUCHER_ALREADY_REDEEMED");

  await client.query(
    `INSERT INTO pos_voucher_redemptions
       (user_id, voucher_id, campaign_id, bill_id, bill_no, employee_id,
        order_subtotal, voucher_face_value, voucher_amount, final_total, voucher_type, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      userId, args.voucherId, args.campaignId, args.billId, args.billNo, args.employeeId,
      args.orderSubtotal, args.voucherFaceValue, args.voucherAmount, args.finalTotal,
      args.voucherType, args.batchId,
    ],
  );
  await logVoucherEvent(client, userId, {
    campaignId: args.campaignId, voucherId: args.voucherId,
    actor: args.employeeId ? "staff" : "owner", action: "redeemed",
    detail: { billNo: args.billNo, amount: args.voucherAmount, type: args.voucherType, batchId: args.batchId },
  });
}

// ═══ analytics ════════════════════════════════════════════════════

export type VoucherCampaignAnalytics = VoucherCampaignStats & {
  /** null สำหรับ percentage (ไม่มีมูลค่าหน้าบัตรเป็นบาท) */
  faceValueTotal: string | null;
  redeemedValue: string;
  revenueFromVoucherOrders: string;
  averageBasket: string | null;
  averageExtraSpend: string | null;
  /** ยอดใช้รายวัน (analytics tab) */
  daily: { date: string; redeemed: number; amount: string }[];
};

export async function getVoucherCampaignAnalytics(
  userId: string,
  campaignId: string,
): Promise<VoucherCampaignAnalytics> {
  const camp = await getVoucherCampaign(userId, campaignId);
  const { rows } = await pool.query<{
    redeemed_value: string; revenue: string; avg_basket: string | null; avg_extra: string | null;
  }>(
    `SELECT COALESCE(SUM(voucher_amount),0)::text AS redeemed_value,
            COALESCE(SUM(order_subtotal),0)::text AS revenue,
            AVG(order_subtotal)::text AS avg_basket,
            AVG(final_total)::text   AS avg_extra
     FROM pos_voucher_redemptions WHERE user_id = $1 AND campaign_id = $2`,
    [userId, campaignId],
  );
  const { rows: daily } = await pool.query<{ d: string; n: string; amt: string }>(
    `SELECT (redeemed_at AT TIME ZONE 'Asia/Bangkok')::date::text AS d,
            count(*)::text AS n, SUM(voucher_amount)::text AS amt
     FROM pos_voucher_redemptions WHERE user_id = $1 AND campaign_id = $2
     GROUP BY 1 ORDER BY 1`,
    [userId, campaignId],
  );
  const money = (v: string | null) => (v == null ? null : centsToDecimalString(toCents(v)));
  return {
    ...camp.stats,
    // percentage ไม่มี "มูลค่าหน้าบัตร" เป็นบาท → null (ห้ามคูณ 20 × ใบ แล้วโชว์เป็นเงิน)
    faceValueTotal: camp.voucherType === "percentage" ? null : centsToDecimalString(toCents(camp.value) * camp.stats.issued),
    redeemedValue: money(rows[0].redeemed_value) ?? "0.00",
    revenueFromVoucherOrders: money(rows[0].revenue) ?? "0.00",
    averageBasket: money(rows[0].avg_basket),
    averageExtraSpend: money(rows[0].avg_extra),
    daily: daily.map((r) => ({ date: r.d, redeemed: Number(r.n), amount: money(r.amt) ?? "0.00" })),
  };
}

// ═══ CSV export (ไม่มี raw token — ไม่มีให้ export อยู่แล้ว) ══════════

export async function exportVouchersCsv(userId: string, campaignId: string): Promise<string> {
  const camp = await getVoucherCampaign(userId, campaignId);
  if (camp.generationMode === "manual_range") return exportManualCodesCsv(userId, camp);
  const { rows } = await pool.query<VoucherRow>(
    `${VOUCHER_SELECT} WHERE v.user_id = $1 AND v.campaign_id = $2 ORDER BY v.public_code`,
    [userId, campaignId],
  );
  // ไม่มี token / token_hash — csvCell กัน formula injection (V1)
  return toCsv({
    headers: ["voucher_code", "campaign", "batch", "distribution_source", "type", "value",
      "minimum_spend", "maximum_discount", "status", "expires_at", "issued_at", "redeemed_at", "bill_no"],
    rows: rows.map(mapVoucher).map((v) => [
      v.publicCode, camp.name, v.batchName ?? "", v.distributionSource ?? "", camp.voucherType, camp.value,
      camp.minimumSpend, camp.maximumDiscount ?? "", v.status, camp.expiresAt, v.issuedAt,
      v.redeemedAt ?? "", v.redeemedBillNo ?? "",
    ]),
  });
}

/**
 * Manual campaign → ขยายช่วงด้วย generate_series ใน SQL (ไม่มีแถวใบ) + สถานะจาก redemptions
 * cap 100,000 แถว (CHECK ขนาดช่วงเดียว ≤ 100k อยู่แล้ว) · ไม่มี token — ไม่มีให้รั่ว
 */
async function exportManualCodesCsv(userId: string, camp: VoucherCampaign): Promise<string> {
  const { rows } = await pool.query<{
    code: string; range_name: string; source: string | null; range_status: string; redeemed_at: Date | string | null; bill_no: string | null;
  }>(
    `SELECT x.code, r.name AS range_name, r.distribution_source AS source, r.status AS range_status, rd.redeemed_at, rd.bill_no
     FROM pos_voucher_manual_ranges r
     CROSS JOIN LATERAL (
       SELECT CASE WHEN r.kind = 'range' THEN r.prefix || '-' || lpad(gs::text, r.padding, '0') ELSE r.custom_code END AS code
       FROM generate_series(COALESCE(r.start_number, 1), COALESCE(r.end_number, 1)) gs
     ) x
     LEFT JOIN pos_voucher_redemptions rd ON rd.manual_range_id = r.id AND rd.manual_code = x.code
     WHERE r.user_id = $1 AND r.campaign_id = $2
     ORDER BY r.created_at, x.code
     LIMIT 100000`,
    [userId, camp.id],
  );
  const expired = new Date(camp.expiresAt) < new Date();
  return toCsv({
    headers: ["code", "campaign", "mode", "range", "distribution_source", "type", "value",
      "minimum_spend", "maximum_discount", "status", "expires_at", "redeemed_at", "bill_no"],
    rows: rows.map((r) => [
      r.code, camp.name, "manual", r.range_name, r.source ?? "", camp.voucherType, camp.value,
      camp.minimumSpend, camp.maximumDiscount ?? "",
      r.redeemed_at ? "redeemed" : r.range_status !== "active" ? r.range_status : expired ? "expired" : "available",
      camp.expiresAt, r.redeemed_at ? iso(r.redeemed_at) : "", r.bill_no ?? "",
    ]),
  });
}

// ═══ batches + analytics ต่อ batch/ช่องทาง ═══════════════════════

export type VoucherBatchAnalytics = VoucherBatch & {
  /** นับจาก pos_vouchers (สถานะสด · expired derive) */
  active: number;
  redeemed: number;
  expired: number;
  cancelled: number;
  blocked: number;
  redemptionRate: number;
  /** จาก redemptions จริง — ไม่ derive จากหน้าบัตร */
  discountGiven: string;
  revenueFromRedeemedOrders: string;
  averageBasket: string | null;
};

/** batch ทั้งหมดของแคมเปญ + สถิติ — aggregate ใน SQL (ไม่โหลดใบ) · ใบ V1 ที่ไม่มี batch นับใน "ไม่ระบุ" ฝั่ง client */
export async function listVoucherBatches(userId: string, campaignId: string): Promise<VoucherBatchAnalytics[]> {
  await getVoucherCampaign(userId, campaignId); // tenant guard → 404 ไม่ใช่ []
  const { rows } = await pool.query<BatchRow & {
    n_active: string; n_active_expired: string; n_redeemed: string; n_cancelled: string; n_blocked: string;
    discount_given: string; revenue: string; avg_basket: string | null;
  }>(
    `SELECT b.id, b.campaign_id, b.name, b.distribution_source, b.quantity_planned, b.quantity_generated, b.created_at,
       COALESCE(s.n_active,0)::text AS n_active, COALESCE(s.n_active_expired,0)::text AS n_active_expired,
       COALESCE(s.n_redeemed,0)::text AS n_redeemed, COALESCE(s.n_cancelled,0)::text AS n_cancelled,
       COALESCE(s.n_blocked,0)::text AS n_blocked,
       COALESCE(r.discount_given,0)::text AS discount_given, COALESCE(r.revenue,0)::text AS revenue, r.avg_basket::text AS avg_basket
     FROM pos_voucher_batches b
     JOIN pos_voucher_campaigns c ON c.id = b.campaign_id
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE v.status IN ('active','issued')) AS n_active,
              count(*) FILTER (WHERE v.status IN ('active','issued') AND c.expires_at < now()) AS n_active_expired,
              count(*) FILTER (WHERE v.status = 'redeemed') AS n_redeemed,
              count(*) FILTER (WHERE v.status = 'cancelled') AS n_cancelled,
              count(*) FILTER (WHERE v.status = 'blocked') AS n_blocked
       FROM pos_vouchers v WHERE v.batch_id = b.id
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT SUM(voucher_amount) AS discount_given, SUM(order_subtotal) AS revenue, AVG(order_subtotal) AS avg_basket
       FROM pos_voucher_redemptions rd WHERE rd.batch_id = b.id
     ) r ON true
     WHERE b.user_id = $1 AND b.campaign_id = $2
     ORDER BY b.created_at DESC`,
    [userId, campaignId],
  );
  const money = (v: string | null) => (v == null ? null : centsToDecimalString(toCents(v)));
  return rows.map((r) => {
    const base = mapBatch(r);
    const redeemed = int(r.n_redeemed);
    return {
      ...base,
      active: int(r.n_active) - int(r.n_active_expired),
      redeemed,
      expired: int(r.n_active_expired),
      cancelled: int(r.n_cancelled),
      blocked: int(r.n_blocked),
      redemptionRate: base.quantityGenerated > 0 ? redeemed / base.quantityGenerated : 0,
      discountGiven: money(r.discount_given) ?? "0.00",
      revenueFromRedeemedOrders: money(r.revenue) ?? "0.00",
      averageBasket: money(r.avg_basket),
    };
  });
}

/** analytics ตามช่องทางแจก (รวมทุก batch ที่ source เดียวกัน) — ตอบ "ช่องทางไหนสร้างยอดขายดีสุด" */
export async function getSourceAnalytics(
  userId: string,
  campaignId: string,
): Promise<{ source: string; generated: number; redeemed: number; discountGiven: string; revenue: string }[]> {
  await getVoucherCampaign(userId, campaignId);
  const { rows } = await pool.query<{ source: string | null; generated: string; redeemed: string; discount_given: string; revenue: string }>(
    `SELECT b.distribution_source AS source,
            SUM(b.quantity_generated)::text AS generated,
            COALESCE(SUM(r.n),0)::text AS redeemed,
            COALESCE(SUM(r.discount_given),0)::text AS discount_given,
            COALESCE(SUM(r.revenue),0)::text AS revenue
     FROM pos_voucher_batches b
     LEFT JOIN LATERAL (
       SELECT count(*) AS n, SUM(voucher_amount) AS discount_given, SUM(order_subtotal) AS revenue
       FROM pos_voucher_redemptions rd WHERE rd.batch_id = b.id
     ) r ON true
     WHERE b.user_id = $1 AND b.campaign_id = $2
     GROUP BY b.distribution_source
     ORDER BY SUM(r.revenue) DESC NULLS LAST`,
    [userId, campaignId],
  );
  return rows.map((r) => ({
    source: r.source ?? "",
    generated: Number(r.generated),
    redeemed: Number(r.redeemed),
    discountGiven: centsToDecimalString(toCents(r.discount_given)),
    revenue: centsToDecimalString(toCents(r.revenue)),
  }));
}
