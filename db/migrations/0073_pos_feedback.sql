-- 0073_pos_feedback — NINENON Feedback Center (QR หน้าร้าน + หน้าออเดอร์)
--
-- ที่มา: QR หน้าร้าน 1 ใบใช้ได้ 5 เรื่อง (รีวิวอาหาร / รีวิวร้าน / เสนอเมนู / แจ้งปัญหา / ชมทีม)
--        แล้วร้านเห็น dashboard คะแนนเฉลี่ยแยกมิติ + เมนูที่ลูกค้าอยากได้
--
-- ═══ การตัดสินใจที่ฝังในสคีมานี้ (อ่านก่อนแก้) ═══════════════════
--
-- 1) แต้มจาก feedback ต้อง "มีบิลจริงในวันขายนั้น" ถึงจะได้
--    เหตุผล: QR แขวนหน้าร้าน ใครเดินผ่านก็สแกนได้ ถ้าให้แต้มทุกครั้ง
--    = เปิดโรงงานปั๊มแต้มฟรี (แต้มมีมูลค่าจริง ฿0.10/แต้ม)
--    กลไก: ต้องกรอกเบอร์ → เบอร์ต้องตรงสมาชิกที่มีบิล paid ใน entry_date เดียวกัน
--
-- 2) กันฟาร์ม 1 ครั้ง/สมาชิก/วันขาย ด้วย partial unique index (ไม่ใช่เช็คใน code)
--    เหตุผล: การเช็คใน application code แพ้ race condition เสมอ
--    ยิงสองครั้งพร้อมกัน = ได้แต้มสองรอบ · index ให้ DB เป็นคนบังคับ
--
-- 3) feedback ที่ไม่กรอกเบอร์ยัง "บันทึก" ได้ปกติ แค่ไม่ได้แต้ม
--    เหตุผล: ลด friction — เสียงที่ตรงไปตรงมาที่สุดมักมาจากคนที่ไม่อยากบอกตัวตน
--    ห้ามบังคับเบอร์ ไม่งั้นเสียคำติที่มีค่าที่สุดไป
--
-- 4) member_id เป็น ON DELETE SET NULL (ไม่ใช่ CASCADE)
--    เหตุผล: ลบสมาชิกไม่ควรลบเสียงลูกค้า — คะแนนเฉลี่ยย้อนหลังต้องคงที่
--
-- 5) product_name เก็บ snapshot คู่กับ product_id
--    เหตุผล: ลบเมนูทิ้งแล้วรายงาน "เมนูนี้ได้ 2 ดาว" ต้องยังอ่านออก
--
-- ⚠️ บัญชี: ตารางนี้ไม่แตะเงินเลย — ไม่มี journal / income_entries / pos_bills
--    แต้มโบนัสเข้า pos_point_events reason='feedback' เท่านั้น
--    invariant Σ line_total = total_amount = debit = credit ยังจริงทุกบิล
--
-- ⚠️ branch_id: ตาราง pos_* ทั้งชุดเป็น single-shop ต่อ user_id (ไม่มี branch_id)
--    ทำตาม convention เดิมของ POS · วันที่ NINENON เปิดสาขา 2 ต้องเพิ่มพร้อมกันทั้งชุด
--    ไม่ใช่เฉพาะตารางนี้ (ไม่งั้น join ข้ามสาขาจะพังแบบเงียบ ๆ)

BEGIN;

-- ── 1) feedback 1 ใบ ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- สมาชิก: NULL = ส่งแบบไม่ระบุตัว (ยอมรับได้ แค่ไม่ได้แต้ม)
  member_id     UUID REFERENCES pos_members(id) ON DELETE SET NULL,
  -- ออเดอร์/บิลที่โยงมา: มีเมื่อมาจากหน้าติดตามออเดอร์ (ไม่ใช่ QR หน้าร้าน)
  -- ไม่ใส่ FK ไป pos_bills ตาม pattern ของ pos_point_events (บิลถูกลบไม่ควรทำ feedback หาย)
  order_id      UUID REFERENCES pos_orders(id) ON DELETE SET NULL,
  bill_id       UUID,

  kind          VARCHAR(20) NOT NULL,
  -- หมวดย่อยที่ลูกค้าเลือก เช่น 'order' / 'qr_pos' / 'staff' / 'food'
  topic         VARCHAR(30),

  -- ⭐ มาจากไหน — ตัวนี้แก้ปัญหาจริงข้อหนึ่ง ไม่ใช่ metadata เฉย ๆ:
  --   quick  = ปุ่มดาวบนหน้าติดตามออเดอร์ (จำกัด 1 ครั้ง/ออเดอร์ ตามพฤติกรรมเดิม 0056)
  --   center = Feedback Center (ให้ส่งได้หลายเรื่องต่อ 1 ออเดอร์ เช่นรีวิวอาหารแล้วแจ้งปัญหาต่อ)
  -- ถ้าไม่แยก ลูกค้าที่กดดาวแล้วเข้ามาให้คะแนนรายเมนูต่อจะโดน unique index ตีตกทั้งใบ
  source        VARCHAR(10) NOT NULL DEFAULT 'center',

  -- คะแนน 1–5 · NULL = ไม่ตอบข้อนั้น (อย่าใช้ 0 แทน "ไม่ตอบ" — ค่าเฉลี่ยจะเพี้ยน)
  rating_overall SMALLINT,
  rating_taste   SMALLINT,
  rating_portion SMALLINT,
  rating_value   SMALLINT,
  rating_service SMALLINT,
  rating_clean   SMALLINT,
  rating_speed   SMALLINT,

  comment       TEXT,
  -- เบอร์ที่ลูกค้ากรอก (normalize แล้ว) เก็บไว้แม้หาสมาชิกไม่เจอ
  -- เพื่อให้ร้านโทรกลับเคสแจ้งปัญหาได้ แม้คนนั้นยังไม่เคยเป็นสมาชิก
  contact_phone VARCHAR(20),

  -- วันขาย (คิด day_cutoff_hour แล้ว) — เป็นแกนของทั้งการกันฟาร์มและรายงาน
  business_date DATE NOT NULL,
  points_awarded INTEGER NOT NULL DEFAULT 0,

  -- คิวงานของร้าน: new → seen → resolved
  status        VARCHAR(20) NOT NULL DEFAULT 'new',
  staff_note    VARCHAR(300),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_kind_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_kind_check
      CHECK (kind IN ('food', 'shop', 'menu_idea', 'issue', 'praise'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_source_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_source_check
      CHECK (source IN ('quick', 'center'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_status_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_status_check
      CHECK (status IN ('new', 'seen', 'resolved'));
  END IF;

  -- คะแนนต้อง 1–5 หรือ NULL เท่านั้น (กันค่าขยะจาก client ที่แก้ payload)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_ratings_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_ratings_check
      CHECK (
        (rating_overall IS NULL OR rating_overall BETWEEN 1 AND 5) AND
        (rating_taste   IS NULL OR rating_taste   BETWEEN 1 AND 5) AND
        (rating_portion IS NULL OR rating_portion BETWEEN 1 AND 5) AND
        (rating_value   IS NULL OR rating_value   BETWEEN 1 AND 5) AND
        (rating_service IS NULL OR rating_service BETWEEN 1 AND 5) AND
        (rating_clean   IS NULL OR rating_clean   BETWEEN 1 AND 5) AND
        (rating_speed   IS NULL OR rating_speed   BETWEEN 1 AND 5)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_points_check') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_points_check
      CHECK (points_awarded >= 0);
  END IF;

  -- ให้แต้มได้ต้องรู้ว่าให้ใคร — กัน orphan point ที่ไม่มีเจ้าของ
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_points_need_member') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_points_need_member
      CHECK (points_awarded = 0 OR member_id IS NOT NULL);
  END IF;

  -- feedback ที่ว่างเปล่าไม่มีประโยชน์: ต้องมีคะแนนอย่างน้อย 1 ช่อง หรือมีข้อความ
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_not_empty') THEN
    ALTER TABLE pos_feedback ADD CONSTRAINT pos_feedback_not_empty
      CHECK (
        COALESCE(rating_overall, rating_taste, rating_portion, rating_value,
                 rating_service, rating_clean, rating_speed) IS NOT NULL
        OR (comment IS NOT NULL AND length(btrim(comment)) > 0)
      );
  END IF;
END $$;

-- ⭐ หัวใจของการกันฟาร์มแต้ม: DB บังคับ 1 ครั้ง/สมาชิก/วันขาย
-- partial index → แถวที่ไม่ได้แต้ม (points_awarded = 0) ส่งกี่ครั้งก็ได้
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_feedback_award_once_per_day
  ON pos_feedback (user_id, member_id, business_date)
  WHERE points_awarded > 0;

-- คิวงานร้าน: อ่านของใหม่ก่อน
CREATE INDEX IF NOT EXISTS idx_pos_feedback_user_created
  ON pos_feedback (user_id, created_at DESC);
-- รายงานคะแนนเฉลี่ยตามช่วงวันขาย
CREATE INDEX IF NOT EXISTS idx_pos_feedback_user_date
  ON pos_feedback (user_id, business_date DESC);
-- ที่ยังไม่ได้อ่าน (badge ตัวเลขแดงบนปุ่ม)
CREATE INDEX IF NOT EXISTS idx_pos_feedback_user_new
  ON pos_feedback (user_id, created_at DESC)
  WHERE status = 'new';

-- ── 2) คะแนนรายเมนู (มีเมื่อ feedback มาจากออเดอร์จริง) ─────────
CREATE TABLE IF NOT EXISTS pos_feedback_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id  UUID NOT NULL REFERENCES pos_feedback(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES pos_products(id) ON DELETE SET NULL,
  product_name VARCHAR(160) NOT NULL,
  rating       SMALLINT NOT NULL,
  comment      VARCHAR(300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_feedback_items_rating_check') THEN
    ALTER TABLE pos_feedback_items ADD CONSTRAINT pos_feedback_items_rating_check
      CHECK (rating BETWEEN 1 AND 5);
  END IF;
END $$;

-- ปุ่มดาวเร็ว: 1 ออเดอร์ = 1 ครั้ง (รักษากฎเดิม UNIQUE(order_id) ของ 0056 ไว้เป๊ะ)
-- Feedback Center ไม่ติดกฎนี้ — ลูกค้าให้คะแนนอาหารแล้วแจ้งปัญหาต่อในออเดอร์เดียวกันได้
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_feedback_quick_once
  ON pos_feedback (order_id)
  WHERE order_id IS NOT NULL AND source = 'quick';

-- 1 เมนูให้คะแนนได้ครั้งเดียวใน feedback ใบเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_feedback_items_unique
  ON pos_feedback_items (feedback_id, product_id)
  WHERE product_id IS NOT NULL;
-- รายงาน "เมนูไหนคะแนนต่ำ"
CREATE INDEX IF NOT EXISTS idx_pos_feedback_items_product
  ON pos_feedback_items (product_id, created_at DESC);

-- ── 3) reason ใหม่ใน ledger แต้ม ────────────────────────────────
-- ต้องเพิ่ม 'feedback' ไม่งั้น INSERT แต้มโบนัสจะโดน CHECK ตีตก
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_point_events_reason_check') THEN
    ALTER TABLE pos_point_events DROP CONSTRAINT pos_point_events_reason_check;
  END IF;
  ALTER TABLE pos_point_events ADD CONSTRAINT pos_point_events_reason_check
    CHECK (reason IN ('earn', 'void_reverse', 'redeem', 'adjust', 'feedback'));
END $$;

-- ── 4) ตั้งค่าต่อร้าน ───────────────────────────────────────────
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS feedback_enabled BOOLEAN NOT NULL DEFAULT true;

-- แต้มโบนัสต่อ 1 feedback · 20 แต้ม = ฿2 ที่ 1 แต้ม = ฿0.10
-- ตั้ง 0 = ปิดการให้แต้ม แต่ยังรับ feedback (เผื่อร้านเปลี่ยนใจภายหลัง)
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS feedback_points INTEGER NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_feedback_points_check'
  ) THEN
    -- เพดาน 500 แต้ม (= ฿50) กันพิมพ์ผิดเป็น 2000 แล้วแจกฟรีทั้งร้าน
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_feedback_points_check
      CHECK (feedback_points >= 0 AND feedback_points <= 500);
  END IF;
END $$;

-- ── 5) ดูดรีวิวเก่าจาก pos_order_feedback (0056) เข้าตารางใหม่ ──
--
-- ทำไมต้องย้าย: dashboard ร้านกับหน้าติดตามออเดอร์ใช้ pos_order_feedback อยู่จริง
-- ถ้าปล่อยไว้จะได้ "เสียงลูกค้าสองแหล่ง" → คะแนนเฉลี่ยไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
-- ตารางเก่าไม่ถูกลบ (เก็บเป็นหลักฐานย้อนกลับได้) แต่จากนี้ไม่มีใครเขียนเข้าอีก
--
-- business_date คิดจาก created_at โดยหัก day_cutoff_hour ให้ตรงกับที่ระบบใช้จริง
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
  'seen',  -- ของเก่าถือว่าเจ้าของร้านเห็นแล้ว ไม่ต้องเด้ง badge ย้อนหลัง
  'quick'  -- รีวิวเก่าทั้งหมดมาจากปุ่มดาว
FROM pos_order_feedback ofb
LEFT JOIN pos_shop_settings s ON s.user_id = ofb.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM pos_feedback f
  WHERE f.order_id = ofb.order_id AND f.source = 'quick'
);

COMMENT ON TABLE pos_order_feedback IS
  'DEPRECATED 0073 — ย้ายไป pos_feedback แล้ว เก็บไว้เป็นหลักฐานเท่านั้น ห้ามเขียนเพิ่ม';

COMMIT;

-- ═══ ตรวจหลังรัน (ต้องได้ตามคอมเมนต์) ═════════════════════════
-- รีวิวเก่าต้องย้ายครบ: two_counts ต้องเท่ากัน
-- SELECT (SELECT COUNT(*) FROM pos_order_feedback) AS old_rows,
--        (SELECT COUNT(*) FROM pos_feedback WHERE source='quick') AS migrated;
-- SELECT
--   (SELECT COUNT(*) FROM pos_feedback)                       AS feedback,        -- 0
--   (SELECT COUNT(*) FROM pos_feedback_items)                 AS feedback_items,  -- 0
--   (SELECT feedback_enabled FROM pos_shop_settings LIMIT 1)   AS fb_enabled,      -- true
--   (SELECT feedback_points FROM pos_shop_settings LIMIT 1)    AS fb_points;       -- 20
