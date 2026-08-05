-- 0068_pos_members — ระบบสมาชิกลูกค้า + สะสมแต้ม (เฟส 1: สะสม/ตัดแต้ม ยังไม่แลกเป็นเงิน)
--
-- ที่มา (5 ส.ค. 2569): ยอดเฉลี่ย ฿71/บิล = เกือบทุกบิลคือเบอร์เกอร์ 1 ชิ้น
--   ไม่รู้ว่าใครเป็นลูกค้าประจำ ไม่มีเหตุผลให้ลูกค้ากลับมา
--   ลูกค้าสแกน QR สั่งอาหารเป็นนิสัยแล้ว → เกาะพฤติกรรมนั้น ไม่สร้างแอปใหม่
--
-- โมเดล:
--   pos_members       = ทะเบียนลูกค้า (ตารางกลางแบบ pos_riders → ไม่มี branch_id
--                       ลูกค้าคนเดียวใช้แต้มได้ทุกสาขา)
--   pos_members.phone = key ที่คนจำได้ · unique ต่อร้าน (user_id, phone)
--   pos_members.access_token = ลิงก์บัตรสมาชิก /card/<token> (UUID เดาไม่ได้ หมุนได้)
--   pos_point_events  = ledger ของแต้ม (append-only) — points เป็นแค่ยอดแคช
--
-- ⚠️ บัญชี: **แต้มไม่ใช่เงิน** ในเฟสนี้
--    - สะสมแต้ม = INSERT pos_point_events + UPDATE points เท่านั้น
--    - ไม่มี journal_entries ไม่มี account ใหม่ ไม่แตะ pos_bills.total_amount
--    - invariant SUM(bill_items.line_total) = bills.total_amount = debit = credit ยังจริงทุกตัวอักษร
--    - "ตัดแต้ม" (redeem) = บันทึกว่าใช้แต้มไปแล้ว ของแถมส่งมือ ไม่ลดยอดบิล
--      → วันที่จะให้แต้มเป็นส่วนลดเงินจริง ต้องออกแบบ journal ก่อน (ลดรายได้ vs ค่าการตลาด)
--        เป็นการตัดสินใจทางบัญชี ไม่ใช่ทาง UI — ยกไปเฟสถัดไปโดยเจตนา
--
-- ยกเลิกบิล → ถอนแต้มคืนด้วย event delta ติดลบ (ไม่ลบ event เดิม ตรวจย้อนหลังได้)
--
-- ตรวจความถูกต้องของยอดแคชได้ตลอดด้วย:
--   SELECT m.id, m.phone, m.points, COALESCE(SUM(e.delta),0) AS ledger
--   FROM pos_members m LEFT JOIN pos_point_events e ON e.member_id = m.id
--   GROUP BY m.id HAVING m.points <> COALESCE(SUM(e.delta),0);
--   -- ต้องได้ 0 แถวเสมอ

BEGIN;

-- ── ทะเบียนลูกค้า ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone         VARCHAR(20) NOT NULL,
  name          VARCHAR(80),
  points        INTEGER NOT NULL DEFAULT 0,
  -- ยอดสะสม/จำนวนครั้ง: ใช้จัดอันดับลูกค้าประจำโดยไม่ต้อง JOIN บิลทั้งกอง
  total_spent   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  visit_count   INTEGER NOT NULL DEFAULT 0,
  last_visit_at TIMESTAMPTZ,
  access_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_members_points_nonneg') THEN
    ALTER TABLE pos_members
      ADD CONSTRAINT pos_members_points_nonneg CHECK (points >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_members_phone_len') THEN
    ALTER TABLE pos_members
      ADD CONSTRAINT pos_members_phone_len CHECK (char_length(phone) BETWEEN 9 AND 20);
  END IF;
END $$;

-- เบอร์เดียวต่อร้าน = key ที่ใช้ค้นหา/รวมยอด
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_members_user_phone
  ON pos_members (user_id, phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_members_access_token
  ON pos_members (access_token);
-- อันดับลูกค้าประจำฝั่งร้าน
CREATE INDEX IF NOT EXISTS idx_pos_members_user_spent
  ON pos_members (user_id, total_spent DESC);

-- ── ledger ของแต้ม (append-only) ─────────────────────────────────
-- bill_id ไม่ผูก FK โดยเจตนา: บิลเป็นข้อมูลบัญชี ห้ามให้ CASCADE ลากลบ
-- (แนวเดียวกับ journal_entries.source_event_id ที่ไม่ผูก FK กับ pos_bills)
CREATE TABLE IF NOT EXISTS pos_point_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES pos_members(id) ON DELETE CASCADE,
  bill_id    UUID,
  delta      INTEGER NOT NULL,
  reason     VARCHAR(20) NOT NULL,
  note       VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_events_reason_check') THEN
    ALTER TABLE pos_point_events
      ADD CONSTRAINT pos_point_events_reason_check
      CHECK (reason IN ('earn', 'void_reverse', 'redeem', 'adjust'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_events_delta_nonzero') THEN
    ALTER TABLE pos_point_events
      ADD CONSTRAINT pos_point_events_delta_nonzero CHECK (delta <> 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_point_events_member
  ON pos_point_events (member_id, created_at DESC);
-- กันให้แต้มบิลเดิมซ้ำ: 1 บิลมี event ต่อ reason ได้ครั้งเดียว
-- index ธรรมดา (ไม่ partial) ได้เลย เพราะ NULL ไม่ชนกันใน unique index
-- → event ที่ bill_id IS NULL (redeem/adjust) ใส่ซ้ำได้ตามปกติ
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_point_events_bill_reason
  ON pos_point_events (bill_id, reason);

-- ── บิลรู้ว่าเป็นของสมาชิกคนไหน ──────────────────────────────────
-- SET NULL: ลบสมาชิกไม่ทำให้บิลหาย (บิลคือข้อมูลบัญชี)
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES pos_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_bills_member
  ON pos_bills (member_id, entry_date DESC)
  WHERE member_id IS NOT NULL;

-- ออเดอร์ QR: ลูกค้าติ๊ก "สะสมแต้ม" → ผูกตอนปิดบิล
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES pos_members(id) ON DELETE SET NULL;

-- ── กติกาแต้มต่อร้าน ─────────────────────────────────────────────
-- baht_per_point = ใช้เงินกี่บาทได้ 1 แต้ม (10 = ซื้อ 100 ได้ 10 แต้ม)
-- points_enabled = false เป็นค่าเริ่มต้น → ร้านที่ไม่เปิดใช้ไม่มีอะไรเปลี่ยน
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS points_enabled  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS baht_per_point  INTEGER NOT NULL DEFAULT 10;
-- ข้อความรางวัลที่ร้านตั้งเอง โชว์บนบัตรสมาชิก (เช่น "100 แต้ม = เฟรนฟรายฟรี")
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS reward_note     VARCHAR(200);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_baht_per_point_check'
  ) THEN
    ALTER TABLE pos_shop_settings
      ADD CONSTRAINT pos_shop_settings_baht_per_point_check
      CHECK (baht_per_point >= 1 AND baht_per_point <= 1000);
  END IF;
END $$;

COMMIT;
