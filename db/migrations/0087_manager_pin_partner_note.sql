-- 0087_manager_pin_partner_note — รหัสผู้จัดการที่ร้านตั้งเอง + หมายเหตุหุ้นส่วน
--
-- ═══ ที่มา (26 ส.ค. 2569) ═══════════════════════════════════════
-- ก) PIN ผู้จัดการฝังอยู่ในโค้ดฝั่ง client (lib/managerLock.ts) เป็น fingerprint
--    ซึ่งถอดกลับได้ในเสี้ยววินาที — ต้องย้ายไปเก็บ hash ที่ฐานข้อมูลและตรวจที่ server
-- ข) หุ้นส่วนยังไม่มีช่องหมายเหตุภายใน (เช่น "ผู้ก่อตั้ง" / "ดูแลการตลาด")
--
-- ═══ กฎเหล็กของไฟล์นี้ ═════════════════════════════════════════
--   ✗ ห้าม seed PIN ใด ๆ ทั้งสิ้น — ไม่มี default ไม่มี master ไม่มี backdoor
--     ร้านที่ยังไม่มี PIN ต้องเข้าหน้าตั้งรหัสครั้งแรกเสมอ
--   ✗ ห้ามแตะชื่อหุ้นส่วนที่เจ้าของแก้ไปแล้ว
--   ✗ ห้าม reset ตั้งค่าเดิม
--   ทุกอย่างเป็น ADD COLUMN IF NOT EXISTS ล้วน — รันซ้ำได้ ไม่ทับของเดิม
--
-- ═══ ทำไมเก็บใน pos_shop_settings ═══════════════════════════════
-- PIN เป็นของ "ร้าน" ไม่ใช่ของคน — หนึ่งร้านหนึ่ง PIN ตรงกับวิธีใช้จริง
-- (เครื่อง POS เครื่องเดียว พนักงานใช้ร่วมกัน ผู้จัดการรู้รหัส)
-- ถ้าวันหนึ่งต้องการ PIN รายบุคคล ค่อยย้ายไป employees พร้อม migration ใหม่

BEGIN;

-- ═══ 1. รหัสผู้จัดการ ═══════════════════════════════════════════
--
-- bcrypt hash ยาว 60 ตัวอักษร — เผื่อไว้ 72 กันเวอร์ชันที่ต่างออกไป
-- NULL = ร้านนี้ยังไม่เคยตั้งรหัส → ต้องเข้าหน้าตั้งรหัสครั้งแรก

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS manager_pin_hash VARCHAR(72);

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS manager_pin_updated_at TIMESTAMPTZ;

-- กัน brute force — PIN 6 หลักมีแค่ 1,000,000 แบบ เดาหมดได้ในไม่กี่นาที
-- ถ้าไม่มีด่านนี้
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS manager_pin_failed_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS manager_pin_locked_until TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_pin_attempts_check'
  ) THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_pin_attempts_check
      CHECK (manager_pin_failed_attempts >= 0);
  END IF;
  -- ตั้งรหัสแล้วต้องมีเวลาที่ตั้ง เพื่อให้ตรวจสอบย้อนหลังได้ว่าเปลี่ยนเมื่อไร
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_pin_stamp_check'
  ) THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_pin_stamp_check
      CHECK (manager_pin_hash IS NULL OR manager_pin_updated_at IS NOT NULL);
  END IF;
END $$;

-- ⚠️ ไม่มี INSERT/UPDATE ใส่ค่า PIN ที่นี่โดยเจตนา
--    ร้านทุกร้านเริ่มจาก manager_pin_hash IS NULL

-- ═══ 2. หมายเหตุหุ้นส่วน ═══════════════════════════════════════
-- ใช้ภายในเท่านั้น (เช่น "ผู้ก่อตั้ง") — ห้ามแสดงตอนคิดเงินหรือให้พนักงานเห็น

ALTER TABLE pos_partners
  ADD COLUMN IF NOT EXISTS note VARCHAR(255);

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
--
-- 1) ทุกร้านต้องยัง "ไม่มี PIN" (จะได้เข้าหน้าตั้งรหัสครั้งแรก)
-- SELECT u.shop_name,
--        (s.manager_pin_hash IS NULL) AS ยังไม่ได้ตั้งรหัส,
--        s.manager_pin_failed_attempts
-- FROM pos_shop_settings s JOIN users u ON u.id = s.user_id;
--
-- 2) ชื่อหุ้นส่วนต้องเหมือนเดิมทุกตัว ไม่ถูก reset
-- SELECT name, nickname, note, is_active FROM pos_partners ORDER BY name;
--
-- 3) ตั้งค่าสิทธิ์หุ้นส่วนเดิมต้องไม่ถูกแตะ
-- SELECT partner_min_profit_per_item, partner_max_discount_percent,
--        partner_allow_below_cost FROM pos_shop_settings;
