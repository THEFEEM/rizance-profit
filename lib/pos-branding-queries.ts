/**
 * Merchant Branding (0095) — Business Profile → Branding
 *
 * แยกจาก upsertPosShopSettings (positional 35 พารามิเตอร์) โดยตั้งใจ:
 * แตะ 3 คอลัมน์ของตัวเองด้วย UPDATE เล็ก ๆ ไม่เสี่ยงเลื่อน $n ของเดิม
 *
 * ใช้ต่อได้กับ voucher card · ใบเสร็จ · QR order · บัตรสมาชิก · manifest
 * ไม่มีอะไรผูกกับร้านใดร้านหนึ่ง — NULL = ยังไม่ตั้ง (UI ใช้ตัวอักษรย่อ + สีดีฟอลต์)
 */
import { z } from "zod";
import { pool } from "@/lib/db";

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex เช่น #16368f");

export const brandingPatchSchema = z.object({
  primaryColor: hexColorSchema.nullable().optional(),
  secondaryColor: hexColorSchema.nullable().optional(),
});
export type BrandingPatch = z.infer<typeof brandingPatchSchema>;

export type MerchantBranding = {
  /** ชื่อร้าน — users.shop_name (source of truth เดิม) */
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
};

type Row = {
  shop_name: string;
  brand_logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
};

const map = (r: Row): MerchantBranding => ({
  name: r.shop_name,
  logoUrl: r.brand_logo_url,
  primaryColor: r.brand_primary_color,
  secondaryColor: r.brand_secondary_color,
});

/** อ่าน branding — สร้างแถว settings ให้ถ้ายังไม่มี (เหมือน getPosShopSettings) */
export async function getMerchantBranding(userId: string): Promise<MerchantBranding> {
  await pool.query(
    `INSERT INTO pos_shop_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const { rows } = await pool.query<Row>(
    `SELECT u.shop_name, s.brand_logo_url, s.brand_primary_color, s.brand_secondary_color
     FROM pos_shop_settings s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw new Error("shop settings missing");
  return map(rows[0]);
}

/** ตั้งสี — undefined = ไม่แตะ · null = ล้าง */
export async function updateMerchantColors(
  userId: string,
  input: BrandingPatch,
): Promise<MerchantBranding> {
  await getMerchantBranding(userId);
  await pool.query(
    `UPDATE pos_shop_settings SET
       brand_primary_color   = CASE WHEN $2 THEN $3 ELSE brand_primary_color END,
       brand_secondary_color = CASE WHEN $4 THEN $5 ELSE brand_secondary_color END,
       updated_at = now()
     WHERE user_id = $1`,
    [
      userId,
      input.primaryColor !== undefined, input.primaryColor ?? null,
      input.secondaryColor !== undefined, input.secondaryColor ?? null,
    ],
  );
  return getMerchantBranding(userId);
}

/** ตั้ง/ล้างโลโก้ — คืน URL เดิมให้ route ลบ object เก่าแบบ best-effort */
export async function setMerchantLogoUrl(
  userId: string,
  logoUrl: string | null,
): Promise<{ branding: MerchantBranding; previousUrl: string | null }> {
  const before = await getMerchantBranding(userId);
  await pool.query(
    `UPDATE pos_shop_settings SET brand_logo_url = $2, updated_at = now() WHERE user_id = $1`,
    [userId, logoUrl],
  );
  return { branding: await getMerchantBranding(userId), previousUrl: before.logoUrl };
}
