import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { centsToDecimalString, toCents } from "@/lib/money";
import {
  evaluatePartnerBenefit,
  assertMarginSafe,
  type PartnerEngineLine,
  type PartnerEvaluation,
  type PartnerSettings,
} from "@/lib/pos-partner-engine";
import { resolveCartModifiers } from "@/lib/pos-modifier-queries";
import { expandComboToLines } from "@/lib/pos-combo-queries";

/**
 * หุ้นส่วน — ข้อมูล + ตั้งค่า + ตัวเชื่อมเข้า closePosBill (0086)
 *
 * ═══ หลักที่ยึด ═══════════════════════════════════════════════
 * 1) client ส่งได้แค่ partnerId — ส่วนลด/ต้นทุน/กำไร server คิดเองทั้งหมด
 *    (pattern เดียวกับ campaign 0074)
 * 2) ต้นทุนมาจาก pos_products.cost_price เท่านั้น ซึ่ง trigger 0076 ดูแลอยู่
 *    ไม่มีเครื่องคิดต้นทุนตัวที่สองในระบบ
 * 3) ไม่ซ้อนกับส่วนลดอื่นระดับบิล — ปฏิเสธพร้อมเหตุผล ไม่เงียบ
 */

export class PartnerNotFoundError extends Error {
  constructor() {
    super("partner_not_found");
    this.name = "PartnerNotFoundError";
  }
}
export class PartnerInactiveError extends Error {
  constructor() {
    super("partner_inactive");
    this.name = "PartnerInactiveError";
  }
}
export class PartnerStackingError extends Error {
  constructor() {
    super("partner_stacking_not_allowed");
    this.name = "PartnerStackingError";
  }
}
export class PartnerMarginError extends Error {
  constructor() {
    super("partner_margin_violation");
    this.name = "PartnerMarginError";
  }
}

export class PartnerDuplicateNameError extends Error {
  constructor() {
    super("partner_duplicate_name");
    this.name = "PartnerDuplicateNameError";
  }
}

export type Partner = {
  id: string;
  name: string;
  nickname: string | null;
  note: string | null;
  isActive: boolean;
};

type PartnerRow = {
  id: string;
  name: string;
  nickname: string | null;
  note: string | null;
  is_active: boolean;
};

const PARTNER_COLS = `id, name, nickname, note, is_active`;

const mapPartner = (r: PartnerRow): Partner => ({
  id: r.id,
  name: r.name,
  nickname: r.nickname,
  note: r.note,
  isActive: r.is_active,
});

/** ชื่อซ้ำในร้านเดียวกันถูกกันด้วย unique index ใน 0086 */
const isDuplicate = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

export async function listPartners(userId: string, activeOnly = false): Promise<Partner[]> {
  const { rows } = await pool.query<PartnerRow>(
    `SELECT ${PARTNER_COLS} FROM pos_partners
     WHERE user_id = $1 ${activeOnly ? "AND is_active" : ""}
     ORDER BY is_active DESC, name ASC`,
    [userId],
  );
  return rows.map(mapPartner);
}

export async function createPartner(
  userId: string,
  input: { name: string; nickname?: string | null; note?: string | null },
): Promise<Partner> {
  try {
    const { rows } = await pool.query<PartnerRow>(
      `INSERT INTO pos_partners (user_id, name, nickname, note)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PARTNER_COLS}`,
      [userId, input.name.trim(), input.nickname?.trim() || null, input.note?.trim() || null],
    );
    return mapPartner(rows[0]);
  } catch (err) {
    if (isDuplicate(err)) throw new PartnerDuplicateNameError();
    throw err;
  }
}

/**
 * แก้ข้อมูลหุ้นส่วน
 *
 * ⚠️ เปลี่ยนชื่อวันนี้ ไม่เปลี่ยนชื่อบนบิลเมื่อวาน —
 *    บิลเก็บ partner_name ไว้เป็น snapshot ตั้งแต่ตอนปิดบิล (0086)
 *    ตารางนี้เก็บแค่ "ชื่อปัจจุบัน" สำหรับใช้ครั้งต่อไปเท่านั้น
 *
 * ไม่มีการลบหุ้นส่วน — ปิดใช้งานแทน เพื่อให้ประวัติยังอ่านได้ครบ
 */
export async function updatePartner(
  userId: string,
  id: string,
  input: { name?: string; nickname?: string | null; note?: string | null; isActive?: boolean },
): Promise<Partner | null> {
  try {
    const { rows } = await pool.query<PartnerRow>(
      `UPDATE pos_partners SET
         name      = COALESCE($3, name),
         nickname  = CASE WHEN $4::boolean THEN $5 ELSE nickname END,
         note      = CASE WHEN $6::boolean THEN $7 ELSE note END,
         is_active = COALESCE($8, is_active),
         updated_at = now()
       WHERE id = $2 AND user_id = $1
       RETURNING ${PARTNER_COLS}`,
      [
        userId,
        id,
        input.name?.trim() || null,
        input.nickname !== undefined,
        input.nickname?.trim() || null,
        input.note !== undefined,
        input.note?.trim() || null,
        input.isActive ?? null,
      ],
    );
    return rows[0] ? mapPartner(rows[0]) : null;
  } catch (err) {
    if (isDuplicate(err)) throw new PartnerDuplicateNameError();
    throw err;
  }
}

// ═══ ตั้งค่า ═══════════════════════════════════════════════════

export type PartnerSettingsView = {
  minProfitPerItem: string;
  maxDiscountPercent: string;
  allowBelowCost: boolean;
};

export async function getPartnerSettings(
  userId: string,
  client?: PoolClient,
): Promise<PartnerSettings & { view: PartnerSettingsView }> {
  const db = client ?? pool;
  const { rows } = await db.query<{
    partner_min_profit_per_item: string;
    partner_max_discount_percent: string;
    partner_allow_below_cost: boolean;
  }>(
    `SELECT partner_min_profit_per_item::text  AS partner_min_profit_per_item,
            partner_max_discount_percent::text AS partner_max_discount_percent,
            partner_allow_below_cost
     FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  // ร้านที่ยังไม่มีแถวตั้งค่า — ใช้ค่าเดียวกับ DEFAULT ใน 0086
  const r = rows[0] ?? {
    partner_min_profit_per_item: "10.00",
    partner_max_discount_percent: "30.00",
    partner_allow_below_cost: false,
  };
  return {
    minProfitPerItemCents: toCents(r.partner_min_profit_per_item),
    maxDiscountPercent: Number(r.partner_max_discount_percent),
    allowBelowCost: r.partner_allow_below_cost,
    view: {
      minProfitPerItem: r.partner_min_profit_per_item,
      maxDiscountPercent: r.partner_max_discount_percent,
      allowBelowCost: r.partner_allow_below_cost,
    },
  };
}

export async function updatePartnerSettings(
  userId: string,
  input: {
    minProfitPerItem?: number;
    maxDiscountPercent?: number;
    allowBelowCost?: boolean;
  },
): Promise<PartnerSettingsView> {
  await pool.query(
    `UPDATE pos_shop_settings SET
       partner_min_profit_per_item  = COALESCE($2, partner_min_profit_per_item),
       partner_max_discount_percent = COALESCE($3, partner_max_discount_percent),
       partner_allow_below_cost     = COALESCE($4, partner_allow_below_cost)
     WHERE user_id = $1`,
    [
      userId,
      input.minProfitPerItem === undefined ? null : input.minProfitPerItem.toFixed(2),
      input.maxDiscountPercent === undefined ? null : input.maxDiscountPercent.toFixed(2),
      input.allowBelowCost ?? null,
    ],
  );
  return (await getPartnerSettings(userId)).view;
}

// ═══ ตัวเชื่อมเข้า checkout ═════════════════════════════════════

export type PartnerApplied = {
  partnerId: string;
  partnerName: string;
  regularTotal: string;
  paidTotal: string;
  discountAmount: string;
  costTotal: string;
  contribution: string;
  perLineDiscountCents: Map<number, number>;
  skipped: PartnerEvaluation["skipped"];
};

/**
 * ตรวจสิทธิ์ + คำนวณ — เรียกจาก closePosBill ภายใน transaction เดียวกัน
 *
 * โยน error ถ้า: ไม่พบหุ้นส่วน · หุ้นส่วนถูกปิด · พยายามซ้อนกับส่วนลดอื่น
 * · หรือผลลัพธ์ละเมิดเพดานล่าง (ซึ่งไม่ควรเกิด — เป็นตาข่ายกันบั๊ก)
 */
export async function applyPartnerBenefit(opts: {
  client: PoolClient;
  userId: string;
  partnerId: string;
  lines: PartnerEngineLine[];
  /** มีส่วนลดระดับบิลอื่นอยู่ไหม (แคมเปญ/คูปอง) */
  hasOtherBillDiscount: boolean;
}): Promise<PartnerApplied> {
  const { client, userId, partnerId, lines } = opts;

  // ── ไม่ซ้อนกับสิทธิ์อื่นระดับบิล ──
  // ระบบเดิมไม่มี policy การซ้อนที่ชัดเจน (member = แต้มไม่ใช่ส่วนลด ·
  // manual discount ยังไม่ได้ทำ) จึงเลือกทางอนุรักษ์ตามที่เจ้าของกำหนด
  if (opts.hasOtherBillDiscount) throw new PartnerStackingError();

  const { rows } = await client.query<PartnerRow>(
    `SELECT ${PARTNER_COLS} FROM pos_partners
     WHERE id = $2 AND user_id = $1`,
    [userId, partnerId],
  );
  if (!rows[0]) throw new PartnerNotFoundError();
  if (!rows[0].is_active) throw new PartnerInactiveError();

  const settings = await getPartnerSettings(userId, client);
  const evaluation = evaluatePartnerBenefit(lines, settings);

  // ตาข่ายกันบั๊ก — ถ้าเครื่องคิดเลขพลาด ยอมยกเลิกดีกว่าปล่อยบิลขาดทุน
  if (!assertMarginSafe(lines, evaluation.lines, settings)) {
    throw new PartnerMarginError();
  }

  const perLineDiscountCents = new Map<number, number>();
  for (const r of evaluation.lines) {
    if (r.discountCents > 0) perLineDiscountCents.set(r.index, r.discountCents);
  }

  return {
    partnerId,
    partnerName: rows[0].name,
    regularTotal: centsToDecimalString(evaluation.regularTotalCents),
    paidTotal: centsToDecimalString(evaluation.paidTotalCents),
    discountAmount: centsToDecimalString(evaluation.discountTotalCents),
    costTotal: centsToDecimalString(evaluation.costTotalCents),
    contribution: centsToDecimalString(evaluation.contributionCents),
    perLineDiscountCents,
    skipped: evaluation.skipped,
  };
}

// ═══ รายงานการใช้สิทธิ์ ═════════════════════════════════════════

export type PartnerReportRow = {
  partnerId: string | null;
  partnerName: string;
  bills: number;
  regularTotal: string;
  paidTotal: string;
  discountTotal: string;
  costTotal: string;
  contribution: string;
};

export type PartnerReportBill = {
  billId: string;
  billNo: string;
  entryDate: string;
  partnerId: string | null;
  partnerName: string;
  regularTotal: string;
  paidTotal: string;
  discountAmount: string;
};

/**
 * สรุปการใช้สิทธิ์หุ้นส่วนตามช่วงวันที่
 *
 * ⚠️ นับเฉพาะ status = 'paid' — บิลที่ถูกยกเลิกหลุดออกเองตามนิยาม
 *    ยอดขายเดิมของระบบ ไม่ต้องมีเงื่อนไขพิเศษ
 * ⚠️ อ่านจาก snapshot บนบิล ไม่คำนวณใหม่ — ต้นทุนหรือชื่อที่เปลี่ยนทีหลัง
 *    จึงไม่ทำให้รายงานย้อนหลังขยับ
 */
export async function partnerReport(
  userId: string,
  from: string,
  to: string,
  partnerId?: string | null,
): Promise<{
  summary: Omit<PartnerReportRow, "partnerId" | "partnerName">;
  perPartner: PartnerReportRow[];
  bills: PartnerReportBill[];
}> {
  const params: (string | null)[] = [userId, from, to];
  if (partnerId) params.push(partnerId);
  const where = `WHERE user_id = $1 AND status = 'paid' AND partner_id IS NOT NULL
                   AND entry_date BETWEEN $2::date AND $3::date
                   ${partnerId ? "AND partner_id = $4" : ""}`;

  const { rows: per } = await pool.query<{
    partner_id: string | null; partner_name: string; bills: number;
    regular_total: string; paid_total: string; discount_total: string;
    cost_total: string; contribution: string;
  }>(
    `SELECT partner_id, partner_name, COUNT(*)::int AS bills,
            COALESCE(SUM(partner_regular_total),0)::text   AS regular_total,
            COALESCE(SUM(partner_paid_total),0)::text      AS paid_total,
            COALESCE(SUM(partner_discount_amount),0)::text AS discount_total,
            COALESCE(SUM(partner_cost_total),0)::text      AS cost_total,
            COALESCE(SUM(partner_contribution),0)::text    AS contribution
     FROM pos_bills ${where}
     GROUP BY partner_id, partner_name
     ORDER BY SUM(partner_paid_total) DESC`,
    params,
  );

  const { rows: bills } = await pool.query<{
    id: string; bill_no: string; entry_date: string;
    partner_id: string | null; partner_name: string;
    partner_regular_total: string; partner_paid_total: string;
    partner_discount_amount: string;
  }>(
    `SELECT id, bill_no, entry_date::text AS entry_date, partner_id, partner_name,
            partner_regular_total::text   AS partner_regular_total,
            partner_paid_total::text      AS partner_paid_total,
            partner_discount_amount::text AS partner_discount_amount
     FROM pos_bills ${where}
     ORDER BY entry_date DESC, created_at DESC
     LIMIT 200`,
    params,
  );

  const add = (xs: string[]) =>
    centsToDecimalString(xs.reduce((s, x) => s + toCents(x), 0));

  return {
    summary: {
      bills: per.reduce((s, r) => s + r.bills, 0),
      regularTotal: add(per.map((r) => r.regular_total)),
      paidTotal: add(per.map((r) => r.paid_total)),
      discountTotal: add(per.map((r) => r.discount_total)),
      costTotal: add(per.map((r) => r.cost_total)),
      contribution: add(per.map((r) => r.contribution)),
    },
    perPartner: per.map((r) => ({
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      bills: r.bills,
      regularTotal: r.regular_total,
      paidTotal: r.paid_total,
      discountTotal: r.discount_total,
      costTotal: r.cost_total,
      contribution: r.contribution,
    })),
    bills: bills.map((b) => ({
      billId: b.id,
      billNo: b.bill_no,
      entryDate: b.entry_date,
      partnerId: b.partner_id,
      partnerName: b.partner_name,
      regularTotal: b.partner_regular_total,
      paidTotal: b.partner_paid_total,
      discountAmount: b.partner_discount_amount,
    })),
  };
}

// ═══ พรีวิวก่อนเก็บเงิน ═════════════════════════════════════════

export type PartnerPreviewLine = {
  productId: string;
  qty: number;
  /** ตัวเลือกเสริม — ราคาต่อหน่วยเปลี่ยนตามนี้ ต้องคิดให้ตรงกับตอนปิดบิล */
  modifierIds?: string[];
};

export type PartnerPreviewItem = {
  productId: string | null;
  name: string;
  qty: number;
  regularTotal: string;
  paidTotal: string;
  discountAmount: string;
  /** null = ได้ส่วนลด · มีค่า = บอกเหตุผลที่ไม่ได้ */
  skipReason: string | null;
};

/**
 * คำนวณให้ดูก่อนกดเก็บเงิน
 *
 * ⚠️ ต้องได้ตัวเลข "เท่ากับ" ตอนปิดบิลเป๊ะ ไม่งั้นแคชเชียร์เห็นเลขหนึ่ง
 *    ลูกค้าจ่ายอีกเลขหนึ่ง — จึงใช้ helper ตัวเดียวกับ closePosBill:
 *      · resolveCartModifiers  (ราคาตัวเลือกเสริม)
 *      · expandComboToLines    (การกระจายราคาคอมโบ)
 *    ไม่คัดลอกสูตรมาเขียนซ้ำแม้แต่บรรทัดเดียว
 */
export async function previewPartnerBenefit(
  userId: string,
  partnerId: string,
  items: PartnerPreviewLine[],
  combos: { comboId: string; qty: number }[] = [],
): Promise<{
  partner: Partner;
  regularTotal: string;
  paidTotal: string;
  discountAmount: string;
  costTotal: string;
  contribution: string;
  items: PartnerPreviewItem[];
  skipped: { productId: string; reason: string }[];
}> {
  const { rows: pr } = await pool.query<PartnerRow>(
    `SELECT ${PARTNER_COLS} FROM pos_partners WHERE id = $2 AND user_id = $1`,
    [userId, partnerId],
  );
  if (!pr[0]) throw new PartnerNotFoundError();
  if (!pr[0].is_active) throw new PartnerInactiveError();

  const client = await pool.connect();
  try {
    const ids = [...new Set(items.map((i) => i.productId))];
    const { rows: prods } = await client.query<{
      id: string; name: string; sell_price: string; cost_price: string;
    }>(
      `SELECT id, name, sell_price::text AS sell_price, cost_price::text AS cost_price
       FROM pos_products WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );
    const byId = new Map(prods.map((p) => [p.id, p]));

    const modifiersByLine = await resolveCartModifiers(client, userId, items);

    type Meta = { productId: string | null; name: string; qty: number; regularCents: number };
    const lines: PartnerEngineLine[] = [];
    const meta: Meta[] = [];

    items.forEach((it, sortOrder) => {
      const p = byId.get(it.productId);
      if (!p) return;
      const mods = modifiersByLine.get(sortOrder) ?? [];
      const unitCents =
        toCents(p.sell_price) + mods.reduce((s, m) => s + toCents(m.priceDelta), 0);
      const lineTotalCents = lineCents(unitCents, it.qty);
      const index = lines.length;
      lines.push({
        index,
        lineTotalCents,
        lineCostCents: lineCents(toCents(p.cost_price), it.qty),
        qty: it.qty,
        alreadyDiscounted: false,
      });
      meta.push({
        productId: p.id,
        name: mods.length > 0 ? `${p.name} +${mods.length} ตัวเลือก` : p.name,
        qty: it.qty,
        regularCents: lineTotalCents,
      });
    });

    // คอมโบ — ราคาลดอยู่แล้ว จึงไม่ได้สิทธิ์ซ้อน แต่ต้องนับรวมในยอดบิล
    for (const c of combos) {
      if (c.qty <= 0) continue;
      const expanded = await expandComboToLines(client, userId, c.comboId, c.qty);
      for (const comp of expanded.lines) {
        const p = await productPriceOf(client, userId, comp.productId);
        const total = toCents(comp.lineTotal);
        const index = lines.length;
        lines.push({
          index,
          lineTotalCents: total,
          lineCostCents: lineCents(toCents(p?.cost_price ?? "0"), comp.quantity),
          qty: comp.quantity,
          alreadyDiscounted: true,
        });
        meta.push({
          productId: comp.productId,
          name: `${expanded.comboName} · ${p?.name ?? ""}`.trim(),
          qty: comp.quantity,
          regularCents: total,
        });
      }
    }

    const settings = await getPartnerSettings(userId, client);
    const ev = evaluatePartnerBenefit(lines, settings);
    const byIndex = new Map(ev.lines.map((l) => [l.index, l]));

    return {
      partner: mapPartner(pr[0]),
      regularTotal: centsToDecimalString(ev.regularTotalCents),
      paidTotal: centsToDecimalString(ev.paidTotalCents),
      discountAmount: centsToDecimalString(ev.discountTotalCents),
      costTotal: centsToDecimalString(ev.costTotalCents),
      contribution: centsToDecimalString(ev.contributionCents),
      items: meta.map((m, i) => {
        const r = byIndex.get(i);
        return {
          productId: m.productId,
          name: m.name,
          qty: m.qty,
          regularTotal: centsToDecimalString(m.regularCents),
          paidTotal: centsToDecimalString(r?.newLineTotalCents ?? m.regularCents),
          discountAmount: centsToDecimalString(r?.discountCents ?? 0),
          skipReason: r?.skipReason ?? null,
        };
      }),
      skipped: ev.skipped.map((s) => ({
        productId: meta[s.index]?.productId ?? "",
        reason: s.reason,
      })),
    };
  } finally {
    client.release();
  }
}

/** คูณจำนวนแบบสตางค์-safe — สูตรเดียวกับ lineMoney() ใน closePosBill */
function lineCents(unitCents: number, qty: number): number {
  return Math.round((unitCents * Math.round(qty * 1000)) / 1000);
}

async function productPriceOf(
  client: PoolClient,
  userId: string,
  productId: string,
): Promise<{ name: string; cost_price: string } | null> {
  const { rows } = await client.query<{ name: string; cost_price: string }>(
    `SELECT name, cost_price::text AS cost_price FROM pos_products
     WHERE id = $2 AND user_id = $1`,
    [userId, productId],
  );
  return rows[0] ?? null;
}
