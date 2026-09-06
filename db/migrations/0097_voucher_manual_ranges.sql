-- 0097_voucher_manual_ranges — Voucher V2.1: Manual Code Mode (API-light) + generation_mode
--
-- ต่อยอด 0094/0096 ไม่รื้อ:
--   · SECURE (เดิม) = ใบละ 1 แถว pos_vouchers + token ลับ + QR — ไม่แตะ
--   · MANUAL_RANGE (ใหม่) = เก็บแค่ "ช่วงเลข" 1 แถว (prefix · start · end · padding) → code derive ได้เอง
--     SUMMER20 + 1..100 + padding 4 → SUMMER20-0001 … SUMMER20-0100 · ไม่สร้าง 100 แถวล่วงหน้า
--     แถวเกิดเฉพาะตอน redeem (pos_voucher_redemptions) → O(1) ตอนออก · O(จำนวนที่ใช้จริง) ตอนใช้
--   · custom code ใบเดียว (VIP-2026) = range ชนิด 'custom' 1 แถว
--   · redemptions: voucher_id → nullable · เพิ่ม manual_range_id + manual_code + redemption_mode + CHECK
--     UNIQUE(manual_range_id, manual_code) = กันใช้ซ้ำระดับ DB (ชั้นสุดท้าย · concurrency ต้องชนที่นี่)
--   · prefix ต้อง unique ต่อร้าน (แคมเปญที่ยังไม่ archive) — ทั้ง secure/manual — เพราะ code ทั้งร้านต้อง resolve ทางเดียว
--     (บั๊กเดิม V1: UNIQUE(user_id, public_code) แต่เลขรันต่อแคมเปญ → prefix ซ้ำ = generate ล้ม 23505 → "unknown_error")
--     สร้าง unique index เฉพาะเมื่อข้อมูลเดิมไม่ซ้ำ — migration ห้ามล้มบน prod · ถ้ามีซ้ำ app เช็คเองและรายงานให้แก้มือ
--
-- Additive · idempotent · รันซ้ำได้ · ไม่แตะแถวเดิม · ไม่ reset ข้อมูล

BEGIN;

-- ── 1) campaign.generation_mode (เดิมทั้งหมด = secure) ───────────
ALTER TABLE pos_voucher_campaigns
  ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(16) NOT NULL DEFAULT 'secure';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_campaigns_generation_mode_check') THEN
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_generation_mode_check
      CHECK (generation_mode IN ('secure', 'manual_range'));
  END IF;
END $$;

-- prefix unique ต่อร้าน (แคมเปญที่ยังไม่ archive) — สร้างเฉพาะเมื่อไม่มีข้อมูลซ้ำอยู่ก่อน
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pos_voucher_campaigns WHERE status <> 'archived'
    GROUP BY user_id, code_prefix HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_voucher_campaigns_prefix_live
      ON pos_voucher_campaigns (user_id, code_prefix) WHERE status <> 'archived';
  ELSE
    RAISE NOTICE '0097: code_prefix ซ้ำในแคมเปญที่ยังไม่ archive — ข้าม unique index (app ยังเช็คเอง) · ดู SQL ตรวจท้ายไฟล์';
  END IF;
END $$;

-- ── 2) manual ranges ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_voucher_manual_ranges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id         UUID NOT NULL REFERENCES pos_voucher_campaigns(id) ON DELETE CASCADE,
  -- 'range' = PREFIX-0001..PREFIX-0100 · 'custom' = code เดียวที่เจ้าของตั้งเอง (VIP-2026)
  kind                VARCHAR(10) NOT NULL DEFAULT 'range',
  -- range: = code_prefix ของแคมเปญเสมอ (app บังคับ) · custom: NULL
  prefix              VARCHAR(12),
  start_number        INTEGER,
  end_number          INTEGER,
  padding             SMALLINT,
  -- custom: code เต็ม normalize แล้ว (A-Z0-9- · ห้ามรูป PREFIX-ตัวเลข)
  custom_code         VARCHAR(32),
  name                VARCHAR(120) NOT NULL,
  distribution_source VARCHAR(60),
  status              VARCHAR(10) NOT NULL DEFAULT 'active',
  created_by          VARCHAR(10) NOT NULL DEFAULT 'owner',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_manual_ranges_kind_check') THEN
    ALTER TABLE pos_voucher_manual_ranges ADD CONSTRAINT pos_voucher_manual_ranges_kind_check
      CHECK (kind IN ('range', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_manual_ranges_status_check') THEN
    ALTER TABLE pos_voucher_manual_ranges ADD CONSTRAINT pos_voucher_manual_ranges_status_check
      CHECK (status IN ('active', 'paused', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_manual_ranges_shape_check') THEN
    ALTER TABLE pos_voucher_manual_ranges ADD CONSTRAINT pos_voucher_manual_ranges_shape_check
      CHECK (
        (kind = 'range'
          AND prefix IS NOT NULL AND prefix ~ '^[A-Z0-9]{2,12}$'
          AND start_number IS NOT NULL AND start_number >= 1
          AND end_number IS NOT NULL AND end_number >= start_number
          AND end_number - start_number + 1 <= 100000
          AND padding IS NOT NULL AND padding BETWEEN 1 AND 8
          AND custom_code IS NULL)
        OR
        (kind = 'custom'
          AND custom_code IS NOT NULL AND custom_code ~ '^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$'
          AND prefix IS NULL AND start_number IS NULL AND end_number IS NULL AND padding IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_voucher_manual_ranges_campaign
  ON pos_voucher_manual_ranges (campaign_id, created_at DESC);
-- resolve code: prefix → ranges ของร้าน (ช่วงเลขเช็คใน app · ไม่กี่แถวต่อ prefix)
CREATE INDEX IF NOT EXISTS idx_pos_voucher_manual_ranges_prefix
  ON pos_voucher_manual_ranges (user_id, prefix)
  WHERE kind = 'range';
-- custom code unique ต่อร้าน (ทุกสถานะ — archive แล้วก็ห้ามตั้งซ้ำ เพราะการ์ดเก่าอาจยังลอยอยู่)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_voucher_manual_ranges_custom
  ON pos_voucher_manual_ranges (user_id, custom_code)
  WHERE custom_code IS NOT NULL;

-- ── 3) redemptions: รองรับ manual (ไม่มี voucher row) ────────────
ALTER TABLE pos_voucher_redemptions ALTER COLUMN voucher_id DROP NOT NULL;
ALTER TABLE pos_voucher_redemptions
  ADD COLUMN IF NOT EXISTS redemption_mode VARCHAR(10) NOT NULL DEFAULT 'secure';
ALTER TABLE pos_voucher_redemptions
  ADD COLUMN IF NOT EXISTS manual_range_id UUID REFERENCES pos_voucher_manual_ranges(id);
ALTER TABLE pos_voucher_redemptions
  ADD COLUMN IF NOT EXISTS manual_code VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_redemptions_mode_check') THEN
    ALTER TABLE pos_voucher_redemptions ADD CONSTRAINT pos_voucher_redemptions_mode_check
      CHECK (
        (redemption_mode = 'secure' AND voucher_id IS NOT NULL AND manual_range_id IS NULL AND manual_code IS NULL)
        OR
        (redemption_mode = 'manual' AND voucher_id IS NULL AND manual_range_id IS NOT NULL AND manual_code IS NOT NULL)
      );
  END IF;
END $$;

-- ⭐ กันใช้ซ้ำระดับ DB: 1 code ใน 1 range ใช้ได้ครั้งเดียว (UNIQUE เดิมบน voucher_id ยังอยู่ · NULL ไม่ชนกัน)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_manual_code
  ON pos_voucher_redemptions (manual_range_id, manual_code)
  WHERE manual_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_manual_range
  ON pos_voucher_redemptions (manual_range_id, redeemed_at DESC)
  WHERE manual_range_id IS NOT NULL;

-- ── self-check ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pos_voucher_manual_ranges') THEN
    RAISE EXCEPTION '0097: pos_voucher_manual_ranges missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'pos_voucher_campaigns' AND column_name = 'generation_mode') THEN
    RAISE EXCEPTION '0097: generation_mode missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'pos_voucher_redemptions' AND column_name = 'voucher_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '0097: redemptions.voucher_id still NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pos_voucher_redemptions_manual_code') THEN
    RAISE EXCEPTION '0097: manual redemption unique index missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_voucher_redemptions WHERE redemption_mode = 'secure' AND voucher_id IS NULL) THEN
    RAISE EXCEPTION '0097: secure redemption without voucher_id';
  END IF;
END $$;

COMMIT;

-- ตรวจหลังรัน:
-- SELECT count(*) FROM pos_vouchers; SELECT count(*) FROM pos_voucher_redemptions;   -- ต้องเท่าก่อนรัน
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_pos_voucher_campaigns_prefix_live'; -- ว่าง = มี prefix ซ้ำอยู่ → ดูบรรทัดถัดไป
-- SELECT user_id, code_prefix, count(*) FROM pos_voucher_campaigns WHERE status <> 'archived'
--   GROUP BY 1,2 HAVING count(*) > 1;   -- แคมเปญที่ prefix ซ้ำ (สาเหตุ generate ล้ม) → archive ตัวที่ไม่ใช้ แล้วรัน 0097 ซ้ำเพื่อสร้าง index
