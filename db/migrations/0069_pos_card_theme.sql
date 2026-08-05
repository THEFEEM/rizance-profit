-- 0069_pos_card_theme — ธีมสีบัตรสมาชิกที่ร้านตั้งเป็นค่าเริ่มต้น
--
-- ที่มา: บัตรสมาชิกเป็นของที่ลูกค้าเปิดดูซ้ำ ๆ ควรเป็นสีของแบรนด์ร้าน
--        ร้านตั้งดีฟอลต์ · ลูกค้าที่อยากเปลี่ยนก็เปลี่ยนได้เอง (เก็บใน localStorage
--        ฝั่งเครื่องลูกค้า ไม่ต้องมีคอลัมน์ต่อคน ไม่ต้องมี write path จากฝั่ง public)
--
-- ⚠️ เก็บเป็น "ชื่อ preset" ไม่ใช่ HEX โดยเจตนา:
--    ถ้าให้เลือกสีอิสระ จะได้บัตรที่อ่านไม่ออก (ตัวอักษรขาวบนพื้นเหลือง ฯลฯ)
--    preset ทุกตัวคุมคู่สีพื้น/ตัวอักษรให้ contrast ผ่านมาแล้ว
--    เพิ่ม preset ใหม่ = แก้ CHECK + ตาราง theme ฝั่ง client ที่เดียว
--
-- ไม่แตะเงิน ไม่แตะแต้ม เป็นเรื่องการแสดงผลล้วน ๆ

BEGIN;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS card_theme VARCHAR(20) NOT NULL DEFAULT 'ink';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_card_theme_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_card_theme_check
      CHECK (card_theme IN ('ink', 'emerald', 'sunset', 'grape', 'ocean', 'charcoal'));
  END IF;
END $$;

COMMIT;
