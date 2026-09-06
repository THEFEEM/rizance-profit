-- 0096_voucher_v2_types_batches — Voucher V2: Percentage / Fixed Discount / Batch / Distribution
--
-- ต่อยอด 0094 ไม่ใช่รื้อ:
--   · voucher_type เดิม 'fixed_amount' = GIFT VALUE (มูลค่าแทนเงิน · ไม่มีเงินทอน) — คงไว้ ใบเดิมทั้งหมดยังอ่านได้
--   · เพิ่ม 'fixed_discount' = ลดเป็นบาท (promotion · มียอดขั้นต่ำ) — คนละความหมายกับ gift แม้สูตรใกล้กัน
--   · 'percentage' มีใน CHECK อยู่แล้ว แต่ไม่มีที่เก็บ min spend / max discount → เพิ่ม 2 คอลัมน์
--   · Batch = ชุดที่ออกภายใต้แคมเปญเดียว (NALAPAT / Instagram / FTU …) + ช่องทางแจก → analytics ตอบได้ว่า
--     "ช่องทางไหนสร้างยอดขายดีสุด" · ใบ V1 ที่ไม่มี batch = batch_id NULL (backward compatible)
--   · redemptions เก็บ voucher_type + batch_id เป็น snapshot (analytics ไม่ต้อง join ย้อน · แคมเปญเปลี่ยนภายหลังไม่กระทบ)
--   · CHECK เดิม voucher_amount <= voucher_face_value ชนกับ percentage (face=20, amount=40) → คลายเฉพาะ percentage
--
-- Additive · idempotent · ไม่แตะแถวเดิม · ไม่ reset ข้อมูล

BEGIN;

-- ── 1) campaign: เงื่อนไขส่วนลด ────────────────────────────────
ALTER TABLE pos_voucher_campaigns
  ADD COLUMN IF NOT EXISTS minimum_spend    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pos_voucher_campaigns
  ADD COLUMN IF NOT EXISTS maximum_discount NUMERIC(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_campaigns_rule_check') THEN
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_rule_check
      CHECK (minimum_spend >= 0 AND (maximum_discount IS NULL OR maximum_discount > 0));
  END IF;
END $$;

-- voucher_type += 'fixed_discount' (drop/add แบบ 0086 — หาชื่อจาก catalog · ค่าเดิม 5 ค่ายังใช้ได้)
DO $$
DECLARE con TEXT;
BEGIN
  -- เจาะจง constraint ประเภท (มีค่า 'store_credit' เฉพาะตัวนี้) — value_check ก็อ้าง voucher_type เหมือนกัน ห้ามจับผิดตัว
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'pos_voucher_campaigns'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%store_credit%';
  IF con IS NOT NULL AND pg_get_constraintdef(
       (SELECT oid FROM pg_constraint WHERE conname = con AND conrelid = 'pos_voucher_campaigns'::regclass)
     ) NOT LIKE '%fixed_discount%' THEN
    EXECUTE format('ALTER TABLE pos_voucher_campaigns DROP CONSTRAINT %I', con);
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_type_check
      CHECK (voucher_type IN ('fixed_amount', 'fixed_discount', 'percentage', 'free_item', 'buy_x_get_y', 'store_credit'));
  END IF;
END $$;

-- ── 2) batches ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_voucher_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id         UUID NOT NULL REFERENCES pos_voucher_campaigns(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  -- ช่องทางแจก — free text (NALAPAT / Instagram / TikTok / Walk-in / FTU / …) ไม่บังคับ enum
  distribution_source VARCHAR(60),
  quantity_planned    INTEGER NOT NULL,
  quantity_generated  INTEGER NOT NULL DEFAULT 0,
  created_by          VARCHAR(10) NOT NULL DEFAULT 'owner',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_batches_qty_check') THEN
    ALTER TABLE pos_voucher_batches ADD CONSTRAINT pos_voucher_batches_qty_check
      CHECK (quantity_planned > 0 AND quantity_generated >= 0 AND quantity_generated <= quantity_planned);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_voucher_batches_campaign
  ON pos_voucher_batches (campaign_id, created_at DESC);
-- analytics ตามช่องทาง
CREATE INDEX IF NOT EXISTS idx_pos_voucher_batches_source
  ON pos_voucher_batches (user_id, distribution_source)
  WHERE distribution_source IS NOT NULL;

-- ── 3) vouchers.batch_id (nullable — ใบ V1 ไม่มี batch) ─────────
ALTER TABLE pos_vouchers
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES pos_voucher_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_vouchers_batch
  ON pos_vouchers (batch_id, status)
  WHERE batch_id IS NOT NULL;

-- ── 4) redemptions: snapshot type + batch · คลาย CHECK สำหรับ percentage ──
ALTER TABLE pos_voucher_redemptions
  ADD COLUMN IF NOT EXISTS voucher_type VARCHAR(20);
ALTER TABLE pos_voucher_redemptions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

-- แถว V1 เดิม = gift ทั้งหมด (V1 ออกได้แค่ fixed_amount)
UPDATE pos_voucher_redemptions SET voucher_type = 'fixed_amount' WHERE voucher_type IS NULL;

DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'pos_voucher_redemptions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%voucher_face_value%';
  IF con IS NOT NULL AND pg_get_constraintdef(
       (SELECT oid FROM pg_constraint WHERE conname = con AND conrelid = 'pos_voucher_redemptions'::regclass)
     ) NOT LIKE '%percentage%' THEN
    EXECUTE format('ALTER TABLE pos_voucher_redemptions DROP CONSTRAINT %I', con);
    ALTER TABLE pos_voucher_redemptions ADD CONSTRAINT pos_voucher_redemptions_math_check
      CHECK (
        voucher_amount >= 0
        AND voucher_amount <= order_subtotal
        AND final_total = order_subtotal - voucher_amount
        AND final_total >= 0
        -- gift/fixed: หักไม่เกินหน้าบัตร · percentage: face_value = % (20) เทียบกับบาทไม่ได้ → ข้าม
        AND (voucher_type = 'percentage' OR voucher_amount <= voucher_face_value)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_batch
  ON pos_voucher_redemptions (batch_id, redeemed_at DESC)
  WHERE batch_id IS NOT NULL;

-- ── self-check ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pos_voucher_batches') THEN
    RAISE EXCEPTION '0096: pos_voucher_batches missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'pos_voucher_campaigns' AND column_name IN ('minimum_spend','maximum_discount')) <> 2 THEN
    RAISE EXCEPTION '0096: campaign rule columns missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pos_voucher_campaigns'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%fixed_discount%') THEN
    RAISE EXCEPTION '0096: voucher_type fixed_discount not allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pos_voucher_redemptions'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%percentage%') THEN
    RAISE EXCEPTION '0096: redemptions math check not relaxed for percentage';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_voucher_redemptions WHERE voucher_type IS NULL) THEN
    RAISE EXCEPTION '0096: redemption rows without voucher_type';
  END IF;
END $$;

COMMIT;

-- ตรวจหลังรัน:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pos_voucher_campaigns'::regclass AND conname='pos_voucher_campaigns_type_check';
-- SELECT count(*) FROM pos_vouchers; SELECT count(*) FROM pos_voucher_redemptions;  -- ต้องเท่าก่อนรัน
