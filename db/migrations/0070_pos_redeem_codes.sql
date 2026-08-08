-- 0070_pos_redeem_codes — แลกแต้มด้วย QR ที่ POS สแกนเท่านั้น
--
-- ที่มา: แต้มครบแล้วลูกค้าต้องมาแลกที่ร้าน — บัตรตัดแต้มเองไม่ได้
--
-- ทำไมไม่เอา pos_members.access_token ใส่ QR ตรง ๆ:
--   access_token คือ "กุญแจถาวร" ของบัตร ถ้าโชว์เป็น QR ให้คนอื่นถ่ายจอไว้
--   ก็ใช้ซ้ำได้ตลอด → ใช้ "โค้ดใช้ครั้งเดียว หมดอายุ 5 นาที" แทน
--
-- คุณสมบัติที่ตารางนี้บังคับ:
--   1) ใช้ได้ครั้งเดียว        → used_at IS NULL + SELECT ... FOR UPDATE ตอนแลก
--   2) หมดอายุเอง             → expires_at
--   3) ข้ามร้านไม่ได้          → unique (user_id, code) + ตรวจ user_id ตอนแลก
--   4) แต้มถูกล็อกตอนสร้างโค้ด → points เก็บไว้ในแถว ไม่คำนวณใหม่ตอนแลก
--                               (กันเคสแต้มเปลี่ยนระหว่างที่ลูกค้าเดินไปหาพนักงาน)
--
-- ⚠️ บัญชี: ยังเป็นเรื่องแต้มล้วน ๆ — ไม่แตะ pos_bills / income_entries / journal
--    รางวัลส่งมือเหมือนเดิม invariant Σ line_total = total_amount = debit = credit ยังจริง

BEGIN;

CREATE TABLE IF NOT EXISTS pos_redeem_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES pos_members(id) ON DELETE CASCADE,
  -- โค้ดสั้นพออ่านออกเสียง/พิมพ์มือได้ ใช้เป็น fallback ตอนกล้องสแกนไม่ติด
  code        VARCHAR(12) NOT NULL,
  points      INTEGER NOT NULL,
  reward_note VARCHAR(200),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_redeem_codes_points_positive') THEN
    ALTER TABLE pos_redeem_codes
      ADD CONSTRAINT pos_redeem_codes_points_positive CHECK (points > 0);
  END IF;
END $$;

-- โค้ดไม่ซ้ำต่อร้าน (ต่างร้านซ้ำได้ ไม่กระทบกัน เพราะตรวจ user_id ตอนแลกด้วย)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_redeem_codes_user_code
  ON pos_redeem_codes (user_id, code);
-- หาโค้ดที่ยังไม่ใช้ของสมาชิกคนนี้ (ตอนขอโค้ดใหม่ต้องยกเลิกใบเก่า)
CREATE INDEX IF NOT EXISTS idx_pos_redeem_codes_member_open
  ON pos_redeem_codes (member_id, created_at DESC)
  WHERE used_at IS NULL;

-- ── เกณฑ์แลกรางวัลต่อร้าน ────────────────────────────────────────
-- แต้มถึงเท่านี้ บัตรจะขึ้นปุ่ม "แลกรางวัล" ให้กดสร้าง QR
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS redeem_points INTEGER NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_redeem_points_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_redeem_points_check
      CHECK (redeem_points >= 1 AND redeem_points <= 100000);
  END IF;
END $$;

COMMIT;
