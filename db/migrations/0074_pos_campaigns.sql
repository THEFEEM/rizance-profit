-- 0074_pos_campaigns — Ninenon Campaigns (Central Campaign Engine)
--
-- ที่มา: ระบบส่วนลด/โปรโมชั่นแบบขยายได้ — เริ่มจาก percentage/fixed
-- แต่โครงรองรับ scope รายเมนู/หมวด, เงื่อนไขเวลา, จำกัดการใช้, coupon code
--
-- ═══ การตัดสินใจที่ฝังในสคีมา (อ่าน docs/discount-system-audit.md ก่อนแก้) ═══
--
-- 1) ส่วนลด "ฝังในราคาบรรทัด" ผ่าน list_unit_price + discount_source='coupon' (มีแล้วจาก 0071)
--    → invariant Σ line_total = total_amount = journal ยังจริง รายงานเดิมไม่ต้องแก้
--    → Coupon = Revenue Reduction ตามการตัดสินใจธุรกิจที่ล็อกไว้
--
-- 2) กัน usage เกิน limit ที่ DB: used_count + atomic UPDATE ... WHERE used_count < usage_limit
--    การเช็คใน code แพ้ race เสมอ (บทเรียนเดียวกับแต้ม feedback)
--
-- 3) per-customer limit บังคับด้วยการนับใน transaction เดียวกับที่ campaign row ถูกล็อก
--    (atomic UPDATE ข้อ 2 ล็อกแถว campaign → การนับ usages ต่อจากนั้น serialize แล้ว)
--
-- 4) ไม่ hard delete — status ARCHIVED · usages เป็น append-only audit log
--
-- 5) ไม่มี branch_id ตาม convention ชุด pos_* (single-shop ต่อ user_id)

BEGIN;

-- ── 1) campaigns ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name        VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  -- coupon code (พิมพ์/สแกน) — NULL = campaign เลือกจากลิสต์ ไม่ต้องมีโค้ด
  code        VARCHAR(40),

  status      VARCHAR(20) NOT NULL DEFAULT 'draft',

  -- ── discount rule ─────────────────────────────────────────
  discount_type  VARCHAR(20) NOT NULL,
  -- percentage: 0–100 (2 ตำแหน่ง) · fixed: จำนวนบาท
  discount_value NUMERIC(12, 2) NOT NULL,

  -- ── scope ────────────────────────────────────────────────
  -- entire_order = ทุกบรรทัดสินค้า (ไม่รวมค่าส่ง) · products = เฉพาะที่ผูกใน campaign_products
  scope       VARCHAR(20) NOT NULL DEFAULT 'entire_order',

  -- ── conditions ───────────────────────────────────────────
  minimum_order_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  maximum_discount_amount NUMERIC(12, 2),          -- NULL = ไม่จำกัด
  usage_limit             INTEGER,                  -- NULL = ไม่จำกัด
  usage_limit_per_customer INTEGER,                 -- NULL = ไม่จำกัด (นับได้เฉพาะสมาชิก)
  used_count              INTEGER NOT NULL DEFAULT 0,

  start_at    TIMESTAMPTZ,                          -- NULL = เริ่มทันที
  end_at      TIMESTAMPTZ,                          -- NULL = ไม่หมดอายุ
  -- happy hour: นาทีจากเที่ยงคืนเวลาไทย (840 = 14:00) · NULL = ทั้งวัน
  time_start_min SMALLINT,
  time_end_min   SMALLINT,
  -- วันในสัปดาห์ '0123456' (0=อาทิตย์) · NULL = ทุกวัน
  days_of_week   VARCHAR(7),

  -- ── eligibility ──────────────────────────────────────────
  -- all = ทุกคน · members = ต้องระบุเบอร์สมาชิกตอนเก็บเงิน
  eligibility VARCHAR(20) NOT NULL DEFAULT 'all',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaigns_status_check') THEN
    ALTER TABLE pos_campaigns ADD CONSTRAINT pos_campaigns_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'archived'));
    -- expired ไม่เป็น status ใน DB โดยเจตนา — คำนวณจาก end_at ตอนอ่าน
    -- (ถ้าเก็บเป็น status ต้องมี cron คอยพลิก ซึ่งระบบนี้ไม่มี — state ที่คำนวณได้อย่าเก็บ)
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaigns_type_check') THEN
    ALTER TABLE pos_campaigns ADD CONSTRAINT pos_campaigns_type_check
      CHECK (discount_type IN ('percentage', 'fixed', 'buy_x_get_y', 'free_item'));
    -- สองตัวหลังเผื่ออนาคต — engine ปัจจุบันจะปฏิเสธถ้าเจอ (ไม่ apply เงียบ ๆ)
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaigns_scope_check') THEN
    ALTER TABLE pos_campaigns ADD CONSTRAINT pos_campaigns_scope_check
      CHECK (scope IN ('entire_order', 'products'));
    -- category scope ทำผ่าน campaign_products (POS แปลงหมวด→รายสินค้าตอนบันทึก)
    -- เพราะสินค้าเปลี่ยนหมวดได้ — ผูกที่ระดับสินค้า ประวัติแคมเปญไม่เพี้ยนย้อนหลัง
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaigns_eligibility_check') THEN
    ALTER TABLE pos_campaigns ADD CONSTRAINT pos_campaigns_eligibility_check
      CHECK (eligibility IN ('all', 'members'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaigns_value_check') THEN
    ALTER TABLE pos_campaigns ADD CONSTRAINT pos_campaigns_value_check
      CHECK (
        discount_value > 0
        AND (discount_type <> 'percentage' OR discount_value <= 100)
        AND minimum_order_amount >= 0
        AND (maximum_discount_amount IS NULL OR maximum_discount_amount > 0)
        AND (usage_limit IS NULL OR usage_limit > 0)
        AND (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0)
        AND used_count >= 0
        AND (time_start_min IS NULL OR (time_start_min >= 0 AND time_start_min < 1440))
        AND (time_end_min   IS NULL OR (time_end_min   > 0 AND time_end_min  <= 1440))
        AND (end_at IS NULL OR start_at IS NULL OR end_at > start_at)
      );
  END IF;
END $$;

-- coupon code ไม่ซ้ำต่อร้าน (เว้น archived — ให้ reuse โค้ดของแคมเปญที่เก็บเข้ากรุแล้วได้)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_campaigns_user_code
  ON pos_campaigns (user_id, upper(code))
  WHERE code IS NOT NULL AND status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_pos_campaigns_user_status
  ON pos_campaigns (user_id, status, created_at DESC);

-- ── 2) scope รายสินค้า ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_campaign_products (
  campaign_id UUID NOT NULL REFERENCES pos_campaigns(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, product_id)
);

-- ── 3) usage log (append-only — ห้าม UPDATE/DELETE) ─────────────
CREATE TABLE IF NOT EXISTS pos_campaign_usages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id     UUID NOT NULL REFERENCES pos_campaigns(id) ON DELETE CASCADE,
  -- bill: ไม่มี FK ตาม pattern ของ point_events (ลบบิลไม่ทำให้ audit หาย)
  bill_id         UUID,
  bill_no         VARCHAR(32),
  member_id       UUID REFERENCES pos_members(id) ON DELETE SET NULL,
  coupon_code     VARCHAR(40),
  discount_amount NUMERIC(12, 2) NOT NULL,
  order_total     NUMERIC(12, 2) NOT NULL,   -- ยอดหลังลด (= total ที่จ่ายจริง)
  order_subtotal  NUMERIC(12, 2) NOT NULL,   -- ยอดก่อนลด — คู่นี้คือฐาน analytics
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_campaign_usages_amount_check') THEN
    ALTER TABLE pos_campaign_usages ADD CONSTRAINT pos_campaign_usages_amount_check
      CHECK (discount_amount >= 0 AND discount_amount <= order_subtotal);
  END IF;
END $$;

-- 1 บิลใช้ campaign ได้ 1 ครั้ง (กัน double-apply จาก retry)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_campaign_usages_bill
  ON pos_campaign_usages (bill_id)
  WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_campaign_usages_campaign
  ON pos_campaign_usages (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_campaign_usages_member
  ON pos_campaign_usages (campaign_id, member_id)
  WHERE member_id IS NOT NULL;

-- ── 4) seed campaigns (idempotent — เช็คชื่อก่อน) ───────────────
-- ⚠️ seed เป็น draft ทั้งหมด — เจ้าของร้านต้องกด active เอง
--    ระบบไม่ควรเปิดส่วนลดจริงโดยที่มนุษย์ยังไม่ยืนยัน
INSERT INTO pos_campaigns
  (user_id, name, code, status, discount_type, discount_value, scope,
   minimum_order_amount, maximum_discount_amount, usage_limit, usage_limit_per_customer,
   start_at, end_at, eligibility)
SELECT u.user_id, v.* FROM (
  VALUES
    ('บัณฑิตวิทยาลัยฟาฎอนี 2569', 'GRAD-FATONI-69', 'draft',
     'percentage', 10.00::numeric, 'entire_order',
     100.00::numeric, 50.00::numeric, 500, 1,
     '2026-08-15 00:00:00+07'::timestamptz, '2026-12-31 23:59:59+07'::timestamptz, 'all'),
    ('Ninenon Member Welcome', NULL, 'draft',
     'percentage', 10.00::numeric, 'entire_order',
     100.00::numeric, NULL::numeric, NULL::int, 1,
     NULL::timestamptz, NULL::timestamptz, 'members'),
    ('Happy Hour', NULL, 'draft',
     'percentage', 15.00::numeric, 'entire_order',
     0.00::numeric, NULL::numeric, NULL::int, NULL::int,
     NULL::timestamptz, NULL::timestamptz, 'all')
) AS v(name, code, status, discount_type, discount_value, scope,
       minimum_order_amount, maximum_discount_amount, usage_limit, usage_limit_per_customer,
       start_at, end_at, eligibility)
CROSS JOIN (SELECT user_id FROM pos_shop_settings LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM pos_campaigns c WHERE c.user_id = u.user_id AND c.name = v.name
);

-- Happy Hour 14:00–17:00
UPDATE pos_campaigns SET time_start_min = 840, time_end_min = 1020
WHERE name = 'Happy Hour' AND time_start_min IS NULL;

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
-- SELECT name, code, status, discount_type, discount_value::text,
--        minimum_order_amount::text, maximum_discount_amount::text,
--        usage_limit, usage_limit_per_customer, time_start_min, time_end_min
-- FROM pos_campaigns ORDER BY created_at;
-- → 3 แถว ทั้งหมด status='draft'
