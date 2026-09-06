import { z } from "zod";

/**
 * Zod schema ของ Gift Voucher — แยกจาก route ด้วยเหตุผลเดียวกับ pos-campaign-schema
 * (App Router ห้าม export ค่าอื่นจาก route.ts)
 */

const trimmed = (max: number, min = 0) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(min).max(max));

export const VOUCHER_TEMPLATES = ["minimal", "premium", "event", "food"] as const;
export type VoucherTemplate = (typeof VOUCHER_TEMPLATES)[number];

/** สีต้องเป็น hex เท่านั้น — ป้องกัน CSS injection ในหน้า public card */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex เช่น #16368f");
/** รูปอนุญาตเฉพาะ https — ห้าม data:/javascript: ในหน้า public */
const httpsUrl = z.string().url().max(500).refine((u) => u.startsWith("https://"), "ต้องเป็น https");

/**
 * design_config ของแคมเปญ = "override" ทับโปรไฟล์ร้าน (0095) เท่านั้น
 *   สี null/ไม่ส่ง  → ใช้สีประจำร้าน (brand_primary/secondary) → ไม่มีก็ดีฟอลต์แพลตฟอร์ม
 *   logoUrl null   → ใช้โลโก้ร้าน (brand_logo_url) → ไม่มีก็ตัวอักษรย่อ
 *   brandName      → legacy override ชื่อบนการ์ด (UI ไม่เสนอแล้ว แต่รับค่าเดิมได้)
 * แถวเดิมที่มีสีชัดเจนอยู่แล้วยังอ่านได้เหมือนเดิม (backward compatible)
 */
export const designConfigSchema = z.object({
  template: z.enum(VOUCHER_TEMPLATES).default("minimal"),
  primaryColor: hexColor.nullable().optional(),
  backgroundColor: hexColor.nullable().optional(),
  brandName: trimmed(60).nullable().optional(),
  logoUrl: httpsUrl.nullable().optional(),
  heroImageUrl: httpsUrl.nullable().optional(),
  showSponsor: z.boolean().default(true),
});
export type VoucherDesignConfig = z.infer<typeof designConfigSchema>;

/** สีดีฟอลต์แพลตฟอร์ม — ใช้เมื่อทั้งแคมเปญและร้านไม่ได้ตั้ง (ไม่ใช่สีของร้านใดร้านหนึ่ง) */
export const PLATFORM_CARD_PRIMARY = "#1f2a44";
export const PLATFORM_CARD_BACKGROUND = "#ffffff";

export type ResolvedCardBrand = {
  merchantName: string;
  logoUrl: string | null;
  primaryColor: string;
  backgroundColor: string;
};

/** Business Profile → Branding → Campaign override — ที่เดียวที่ตัดสินว่าการ์ดใช้อะไร */
export function resolveCardBrand(
  design: VoucherDesignConfig,
  merchant: { name: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null },
): ResolvedCardBrand {
  return {
    merchantName: design.brandName?.trim() || merchant.name,
    logoUrl: design.logoUrl ?? merchant.logoUrl ?? null,
    primaryColor: design.primaryColor ?? merchant.primaryColor ?? PLATFORM_CARD_PRIMARY,
    backgroundColor: design.backgroundColor ?? merchant.secondaryColor ?? PLATFORM_CARD_BACKGROUND,
  };
}

/**
 * ประเภท voucher (V2)
 *   fixed_amount   = GIFT VALUE — มูลค่าแทนเงิน · ไม่มีเงินทอน · ไม่มียอดขั้นต่ำ (ชื่อเดิมจาก V1 คงไว้เพื่อ backward compat)
 *   percentage     = ส่วนลด % — มี minimum_spend / maximum_discount
 *   fixed_discount = ลดเป็นบาท — promotion · มี minimum_spend
 *   free_item / buy_x_get_y / store_credit = เผื่ออนาคต (engine ปฏิเสธ)
 * gift กับ fixed_discount คำนวณคล้ายกันแต่ "ความหมายทางธุรกิจ" ต่างกัน → ห้ามยุบรวม (UI/analytics/บัญชี)
 */
export const VOUCHER_TYPES = [
  "fixed_amount",
  "percentage",
  "fixed_discount",
  "free_item",
  "buy_x_get_y",
  "store_credit",
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
/** ที่ MVP รองรับจริงตั้งแต่ต้นจนจบ (สร้าง → การ์ด → POS → redeem) */
export const REDEEMABLE_VOUCHER_TYPES: readonly VoucherType[] = ["fixed_amount", "percentage", "fixed_discount"];

export const voucherCampaignSchema = z
  .object({
    name: trimmed(120, 1),
    description: trimmed(500).nullable().optional(),
    sponsor: trimmed(120).nullable().optional(),
    /** MVP เปิดใช้จริงเฉพาะ fixed_amount — ค่าอื่นรับได้แต่ engine จะปฏิเสธตอน redeem */
    voucherType: z.enum(VOUCHER_TYPES).default("fixed_amount"),
    /** gift/fixed = บาท · percentage = 0–100 */
    value: z.number().finite().gt(0).max(999_999.99),
    /** ยอดซื้อขั้นต่ำ (บาท) — 0 = ไม่มี · gift ควรเป็น 0 */
    minimumSpend: z.number().finite().min(0).max(999_999.99).default(0),
    /** ลดสูงสุด (บาท) — percentage เท่านั้น · null = ไม่จำกัด */
    maximumDiscount: z.number().finite().gt(0).max(999_999.99).nullable().optional(),
    quantityPlanned: z.number().int().min(1).max(100_000).nullable().optional(),
    startAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    codePrefix: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
      z.string().regex(/^[A-Z0-9]{2,12}$/, "A-Z 0-9 ยาว 2–12 ตัว"),
    ),
    terms: trimmed(4000).nullable().optional(),
    designConfig: designConfigSchema.default(() => designConfigSchema.parse({})),
    allowedBranchIds: z.array(z.string().uuid()).max(50).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.voucherType === "percentage" && v.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "percentage ≤ 100" });
    }
    if (v.voucherType !== "percentage" && v.maximumDiscount != null) {
      ctx.addIssue({ code: "custom", path: ["maximumDiscount"], message: "ลดสูงสุดใช้กับส่วนลด % เท่านั้น" });
    }
    if (v.voucherType === "fixed_discount" && v.minimumSpend > 0 && v.minimumSpend < v.value) {
      ctx.addIssue({ code: "custom", path: ["minimumSpend"], message: "ยอดขั้นต่ำต้องไม่น้อยกว่าส่วนลด" });
    }
    if (new Date(v.expiresAt) <= new Date(v.startAt)) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "หมดอายุต้องหลังวันเริ่ม" });
    }
  });
export type VoucherCampaignInput = z.infer<typeof voucherCampaignSchema>;

export const voucherCampaignStatusSchema = z.object({
  status: z.enum(["draft", "active", "paused", "ended", "archived"]),
});

/**
 * Bulk generate — ขีดจำกัดจาก V1: 1–1,000 ต่อ request (1 INSERT unnest · token 1,000 ตัวใน memory ≈ 40 KB ·
 * Vercel function ไม่ค้าง) · แคมเปญใหญ่กว่านั้นยิงหลาย batch · cap รวมด้วย campaign.quantity_planned
 * V2: ทุกการ generate สร้าง batch เสมอ (ชื่อ + ช่องทางแจก) — ไม่บังคับกรอก ใช้ดีฟอลต์ "Batch #n"
 */
export const generateVouchersSchema = z.object({
  quantity: z.number().int().min(1).max(1000),
  batchName: trimmed(120).nullable().optional(),
  distributionSource: trimmed(60).nullable().optional(),
});

export const voucherListQuerySchema = z.object({
  status: z
    .enum(["all", "active", "redeemed", "expired", "cancelled", "blocked", "issued"])
    .default("all"),
  q: trimmed(40).optional(),
  batchId: z.string().uuid().optional(),
  source: trimmed(60).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

export const voucherValidateSchema = z.object({
  /** token ดิบ หรือ URL ที่สแกนได้ — server แกะเอง */
  scan: z.string().min(4).max(600),
});

export const voucherActionSchema = z.object({
  reason: trimmed(200).nullable().optional(),
});
