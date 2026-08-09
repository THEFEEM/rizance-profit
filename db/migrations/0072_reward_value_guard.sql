-- 0072 — มูลค่ารางวัล + กติกากันตั้ง Reward ที่คืนเกินเป้า
--
-- ที่มา: reward_note เป็นข้อความอิสระ ("50 แต้ม แลก Wrap Z")
--        ระบบจึงไม่รู้ว่ารางวัลมีมูลค่าเท่าไหร่ → ตรวจไม่ได้ว่าคืนเกิน 8% หรือยัง
--        และเคยตั้ง 50 แต้มแลก Wrap Z ฿65 ไปจริง = คืน 130% ของมูลค่าแต้ม
--
-- กติกาที่บังคับตั้งแต่ตอนนี้ (ตรวจทั้ง DB, API และ UI):
--
--        reward_value  ≤  redeem_points × (point_value_satang / 100)
--
--   ✅ Wrap-Z ฿65 · 650 แต้ม · 10 สต. → 650×0.10 = ฿65  ≥ ฿65   valid
--   ❌ Wrap-Z ฿65 · 500 แต้ม · 10 สต. → 500×0.10 = ฿50  < ฿65   INVALID
--   ✅ เฟรนฟราย ฿35 · 350 แต้ม        → ฿35 ≥ ฿35              valid
--
-- Effective Loyalty % ของรางวัลหนึ่ง ๆ:
--   eff% = loyalty_return_pct × reward_value ÷ (redeem_points × point_value_satang/100)
--   ตัวอย่าง: 8% × 65 ÷ 65 = 8.0%   ← ตรงเป้า
--             8% × 65 ÷ 50 = 10.4%  ← เกินเป้า ระบบต้องเตือน
--
-- ⚠️ CHECK ระดับตาราง "ทำไม่ได้" เพราะเงื่อนไขข้ามหลายคอลัมน์ที่แก้ทีละตัวได้
--    (แก้ reward_value ก่อน redeem_points จะทำให้ติด constraint ชั่วคราวโดยไม่จำเป็น)
--    → บังคับที่ API layer แทน + คอลัมน์นี้ทำให้ตรวจได้ ซึ่งเดิมตรวจไม่ได้เลย
--
-- ไม่แตะเงิน ไม่แตะบัญชี — ยังเป็นเรื่องแต้มล้วน

BEGIN;

-- มูลค่ารางวัลจริงเป็นบาท (ต้นทุน/ราคาขายของที่แจก) · NULL = ยังไม่ได้ระบุ
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS reward_value NUMERIC(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_reward_value_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_reward_value_check
      CHECK (reward_value IS NULL OR (reward_value > 0 AND reward_value <= 100000));
  END IF;
END $$;

COMMENT ON COLUMN pos_shop_settings.reward_value IS
  'มูลค่ารางวัลเป็นบาท — ต้อง <= redeem_points × point_value_satang/100 มิฉะนั้นคืนเกินเป้า';

-- ค่าเริ่มต้นตามที่ตกลง: คืน 8% · 1 แต้ม = 10 สตางค์
-- (คอลัมน์เหล่านี้มาจาก 0071 · ที่นี่แค่ตั้งค่าให้ร้านที่ยังไม่ได้ตั้งเอง)
UPDATE pos_shop_settings
SET loyalty_return_pct = 8.00,
    point_value_satang = 10
WHERE loyalty_return_pct IS NULL OR point_value_satang IS NULL;

COMMIT;

-- ── ตรวจหลังรัน ─────────────────────────────────────────────────
-- SELECT loyalty_return_pct, point_value_satang, loyalty_use_pct,
--        redeem_points, reward_value, reward_note,
--        (redeem_points * point_value_satang / 100.0) AS point_value_baht,
--        CASE WHEN reward_value IS NULL THEN 'ยังไม่ระบุมูลค่า'
--             WHEN reward_value <= redeem_points * point_value_satang / 100.0
--               THEN '✅ ไม่เกินเป้า'
--             ELSE '❌ คืนเกินเป้า' END AS verdict
-- FROM pos_shop_settings;
