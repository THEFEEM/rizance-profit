-- ตรวจ + ซ่อม migration 0073 ให้ครบ (รันซ้ำได้ ไม่มีผลข้างเคียง)
--
-- ที่มา: การรัน 0073 หยุดกลางทาง — index idx_pos_feedback_quick_once ไม่ถูกสร้าง
-- ทั้งที่ idx_pos_feedback_order_kind ถูกลบไปแล้ว (สองคำสั่งอยู่ในไฟล์เดียวกัน)
-- ⚠️ ถ้าปล่อยไว้: ปุ่มดาวบนหน้าออเดอร์จะให้คะแนนซ้ำได้ไม่จำกัด (กฎเดิม 0056 หลุด)

-- ═══ STEP 1 · เช็คว่าอะไรลงแล้ว อะไรยังไม่ลง ══════════════════
-- อ่านทีละคอลัมน์ ตัวไหนเป็น false / 0 คือยังไม่ลง

SELECT
  -- โครงตาราง
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pos_feedback' AND column_name = 'source')      AS has_source,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_name = 'pos_feedback_items')                           AS has_items_table,

  -- index ที่ต้องมี
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_award_once_per_day')           AS has_award_idx,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_quick_once')                   AS has_quick_idx,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_items_unique')                 AS has_item_idx,
  -- index รุ่นแรกต้องไม่มี
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_order_kind')                   AS has_stale_idx,

  -- CHECK ที่ต้องมี
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_source_check')
                                                                            AS has_source_check,
  (SELECT pg_get_constraintdef(oid) LIKE '%feedback%' FROM pg_constraint
   WHERE conname = 'pos_point_events_reason_check')                          AS reason_has_feedback,

  -- settings
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pos_shop_settings' AND column_name = 'feedback_enabled')
                                                                            AS has_fb_enabled,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pos_shop_settings' AND column_name = 'feedback_points')
                                                                            AS has_fb_points,

  -- ย้ายรีวิวเก่า
  (SELECT COUNT(*) FROM pos_order_feedback)                                  AS old_rows,
  (SELECT COUNT(*) FROM pos_feedback)                                        AS fb_rows;

-- ═══ STEP 2 · ซ่อมส่วนที่ขาด (idempotent ทุกคำสั่ง) ════════════
-- รันทั้งก้อนได้เลย ของที่มีอยู่แล้วจะถูกข้ามเอง

BEGIN;

-- 2a) คอลัมน์ source
ALTER TABLE pos_feedback
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'center';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_source_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_source_check
      CHECK (source IN ('quick', 'center'));
  END IF;
END $$;

-- 2b) index รุ่นแรกทิ้ง · index จริงสร้าง
DROP INDEX IF EXISTS idx_pos_feedback_order_kind;

-- ⭐ ตัวที่ขาดไป: ปุ่มดาวเร็ว 1 ออเดอร์ = 1 ครั้ง
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_feedback_quick_once
  ON pos_feedback (order_id)
  WHERE order_id IS NOT NULL AND source = 'quick';

-- 2c) reason 'feedback' ใน ledger แต้ม
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_events_reason_check') THEN
    ALTER TABLE pos_point_events DROP CONSTRAINT pos_point_events_reason_check;
  END IF;
  ALTER TABLE pos_point_events ADD CONSTRAINT pos_point_events_reason_check
    CHECK (reason IN ('earn', 'void_reverse', 'redeem', 'adjust', 'feedback'));
END $$;

-- 2d) settings
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS feedback_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS feedback_points INTEGER NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_feedback_points_check'
  ) THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_feedback_points_check
      CHECK (feedback_points >= 0 AND feedback_points <= 500);
  END IF;
END $$;

-- 2e) ย้ายรีวิวเก่าที่ยังไม่ได้ย้าย (NOT EXISTS กันย้ายซ้ำ)
INSERT INTO pos_feedback (
  user_id, order_id, kind, rating_overall, comment, business_date, created_at, status, source
)
SELECT
  ofb.user_id,
  ofb.order_id,
  'food',
  ofb.rating,
  ofb.comment,
  ((ofb.created_at AT TIME ZONE 'Asia/Bangkok')
     - make_interval(hours => COALESCE(s.day_cutoff_hour, 0)))::date,
  ofb.created_at,
  'seen',
  'quick'
FROM pos_order_feedback ofb
LEFT JOIN pos_shop_settings s ON s.user_id = ofb.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM pos_feedback f
  WHERE f.order_id = ofb.order_id AND f.source = 'quick'
);

COMMIT;

-- ═══ STEP 3 · ตรวจซ้ำ — ทุกช่องต้องเป็นค่าที่คอมเมนต์ไว้ ═══════

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'pos_feedback' AND column_name = 'source')      AS has_source,        -- true
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_quick_once')                   AS has_quick_idx,     -- true
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_pos_feedback_order_kind')                   AS has_stale_idx,     -- false
  (SELECT pg_get_constraintdef(oid) LIKE '%feedback%' FROM pg_constraint
   WHERE conname = 'pos_point_events_reason_check')                          AS reason_ok,         -- true
  (SELECT feedback_enabled FROM pos_shop_settings LIMIT 1)                   AS fb_enabled,        -- true
  (SELECT feedback_points  FROM pos_shop_settings LIMIT 1)                   AS fb_points,         -- 20
  (SELECT COUNT(*) FROM pos_order_feedback)                                  AS old_rows,
  (SELECT COUNT(*) FROM pos_feedback WHERE source = 'quick')                 AS migrated;
  -- old_rows ต้องเท่ากับ migrated

-- index ทั้งหมดของ pos_feedback — ต้องเห็น 6 ตัว (pkey + award + quick + user_created + user_date + user_new)
SELECT indexname FROM pg_indexes WHERE tablename = 'pos_feedback' ORDER BY indexname;
