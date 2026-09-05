-- 0095_merchant_branding — Business Profile → Branding (โลโก้ + สีประจำร้าน)
--
-- ที่มา: Gift Voucher card ต้องเป็น multi-merchant — โลโก้/สีของร้านต้องมาจากโปรไฟล์ร้าน
-- ไม่ใช่กรอก URL ซ้ำทุกแคมเปญ และไม่ใช่ hardcode ใน rizance-pos/lib/shopBrand.ts
-- (ไฟล์นั้นเขียนไว้เองว่า "วันที่มีร้านที่ 2 ให้เพิ่ม pos_shop_settings.logo_url")
--
-- pos_shop_settings = โปรไฟล์ร้าน 1 แถวต่อ user_id อยู่แล้ว (ชื่อร้านอยู่ที่ users.shop_name)
-- → ต่อยอด minimal 3 คอลัมน์ ไม่สร้างตาราง business ใหม่ (ไม่มี business entity ในระบบ)
--
-- ใช้ต่อได้กับ: voucher card · ใบเสร็จ · QR order · บัตรสมาชิก · manifest (Phase ถัดไป)
-- Additive · idempotent · nullable ทั้งหมด (NULL = ยังไม่ตั้ง → UI ใช้ตัวอักษรย่อ/สีดีฟอลต์)

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS brand_logo_url        TEXT;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS brand_primary_color   VARCHAR(7);
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS brand_secondary_color VARCHAR(7);

-- สีต้องเป็น #rrggbb เท่านั้น — กัน CSS injection ในหน้า public (การ์ด/ใบเสร็จ)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_brand_color_check') THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_brand_color_check
      CHECK (
        (brand_primary_color   IS NULL OR brand_primary_color   ~ '^#[0-9a-fA-F]{6}$')
        AND (brand_secondary_color IS NULL OR brand_secondary_color ~ '^#[0-9a-fA-F]{6}$')
      );
  END IF;
END $$;

-- self-check
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'pos_shop_settings'
        AND column_name IN ('brand_logo_url','brand_primary_color','brand_secondary_color')) <> 3 THEN
    RAISE EXCEPTION '0095: branding columns missing';
  END IF;
END $$;

COMMIT;

-- ตรวจหลังรัน:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name='pos_shop_settings' AND column_name LIKE 'brand_%';
-- SELECT count(*) FROM pos_shop_settings;  -- ต้องเท่าก่อนรัน
