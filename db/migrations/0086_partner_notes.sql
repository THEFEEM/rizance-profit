-- 0086_partner_notes — สิทธิ์หุ้นส่วน + สมุดร้าน
--
-- ═══ ที่มา (25 ส.ค. 2569) ═══════════════════════════════════════
-- ก) หุ้นส่วน 4 คนซื้ออาหารร้านได้ในราคาพิเศษ แต่ห้ามต่ำกว่าทุน + กำไรขั้นต่ำ
-- ข) ปัญหาหน้าร้านหายไปในไลน์ ต้องมีสมุดกลางที่พนักงานแจ้งเข้ามาได้
--
-- ═══ สิ่งที่ "ไม่" ทำ ═══════════════════════════════════════════
--   ✗ ไม่สร้างระบบต้นทุนใหม่ — ใช้ pos_products.cost_price ที่ trigger 0076 ดูแล
--   ✗ ไม่สร้างระบบส่วนลดใหม่ — ใช้ list_unit_price + discount_source เดิม (0071)
--   ✗ ไม่สร้าง expense จากส่วนลดหุ้นส่วน — มันคือรายได้ที่ลดลง ไม่ใช่เงินจ่ายออก
--     (หลักเดียวกับที่ตัดสินไว้แล้วเรื่องคูปอง · ดู docs/discount-system-audit.md)
--   ✗ ไม่แตะ invariant Σ line_total = total_amount = journal
--
-- ═══ กฎตัวตนที่บังคับถึงระดับฐานข้อมูล (สำคัญที่สุดของไฟล์นี้) ═══
-- เครื่อง POS ล็อกอินด้วยบัญชี "เจ้าของ" — ไม่รู้ว่าพนักงานคนไหนกำลังกด
-- แอป /e/[token] ผูกกับ employees.id — รู้แน่ชัดว่าใคร
--
--   created_by_user_id      = บัญชี/เซสชันที่สร้างแถว
--   reported_by_employee_id = พนักงานตัวจริงที่แจ้ง
--   ห้ามเอาสองอย่างนี้มาปนกัน
--
-- CHECK ข้างล่างบังคับว่า source='pos_device' ต้องไม่มีตัวตนผู้แจ้งเด็ดขาด
-- → ต่อให้โค้ดพลาด ฐานข้อมูลก็ไม่ยอมให้เดาชื่อคนลงไป
--
-- ═══ ย้อนกลับได้ไหม ═══════════════════════════════════════════
-- ตารางใหม่ 2 ตัว DROP ได้ · คอลัมน์ที่เพิ่มเป็น nullable/มี default ทั้งหมด
-- ข้อมูลเดิมไม่ถูกแก้แม้แต่แถวเดียว

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 1 · หุ้นส่วน
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pos_partners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  nickname   VARCHAR(60),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_partners_name
  ON pos_partners (user_id, name);
CREATE INDEX IF NOT EXISTS idx_pos_partners_active
  ON pos_partners (user_id, is_active);

-- seed 4 คน · ชื่อเป็นค่าตั้งต้น เจ้าของแก้เป็นชื่อจริงทีหลังได้
-- ไม่ hard-code ชื่อจริงลง logic ที่ไหนทั้งสิ้น — โค้ดอ้าง id เท่านั้น
INSERT INTO pos_partners (user_id, name)
SELECT s.user_id, v.name
FROM pos_shop_settings s
CROSS JOIN (VALUES ('หุ้นส่วน 1'), ('หุ้นส่วน 2'), ('หุ้นส่วน 3'), ('หุ้นส่วน 4')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM pos_partners p WHERE p.user_id = s.user_id AND p.name = v.name
);

-- ── ตั้งค่าสิทธิ์หุ้นส่วน ──
-- partner_allow_below_cost = false เป็นค่าตั้งต้นและควรอยู่แบบนั้น
-- เปิดเป็น true = ยอมขายขาดทุนให้หุ้นส่วน ซึ่งเจ้าของต้องตั้งใจจริง ๆ
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS partner_min_profit_per_item  NUMERIC(12,2) NOT NULL DEFAULT 10;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS partner_max_discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 30;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS partner_allow_below_cost     BOOLEAN       NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_partner_pct_check'
  ) THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_partner_pct_check
      CHECK (partner_max_discount_percent >= 0 AND partner_max_discount_percent <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_partner_profit_check'
  ) THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_partner_profit_check
      CHECK (partner_min_profit_per_item >= 0);
  END IF;
END $$;

-- ── snapshot บนบิล ──
-- เก็บชื่อและตัวเลขทั้งหมด ณ วันที่ขาย เพื่อให้ประวัติไม่เปลี่ยน
-- แม้ภายหลังหุ้นส่วนเปลี่ยนชื่อ หรือต้นทุนวัตถุดิบขยับ
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_id              UUID REFERENCES pos_partners(id) ON DELETE SET NULL;
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_name            VARCHAR(120);
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_discount_amount NUMERIC(12,2);
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_regular_total   NUMERIC(12,2);
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_paid_total      NUMERIC(12,2);
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_cost_total      NUMERIC(12,2);
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS partner_contribution    NUMERIC(12,2);

DO $$
BEGIN
  -- ยอดต้องสอดคล้องกันเสมอ ไม่ว่าจะเขียนจากทางไหน
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_bills_partner_math_check') THEN
    ALTER TABLE pos_bills ADD CONSTRAINT pos_bills_partner_math_check
      CHECK (
        partner_id IS NULL
        OR (
          partner_discount_amount = partner_regular_total - partner_paid_total
          AND partner_contribution = partner_paid_total - partner_cost_total
          AND partner_discount_amount >= 0
          AND partner_regular_total   >= 0
          AND partner_paid_total      >= 0
          AND partner_cost_total      >= 0
        )
      );
  END IF;
  -- ใช้สิทธิ์แล้วต้องมีชื่อ snapshot เสมอ
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_bills_partner_name_check') THEN
    ALTER TABLE pos_bills ADD CONSTRAINT pos_bills_partner_name_check
      CHECK (partner_id IS NULL OR partner_name IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_bills_partner
  ON pos_bills (user_id, partner_id, entry_date DESC)
  WHERE partner_id IS NOT NULL;

-- ── discount_source += 'partner' (additive — ค่าเดิมทั้ง 4 ใช้ได้เหมือนเดิม) ──
-- หาชื่อ constraint จาก catalog เหมือน 0081/0084 แทนการเดาชื่อ
DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'pos_bill_items'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%combo%'
    AND pg_get_constraintdef(oid) LIKE '%reward%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pos_bill_items DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE pos_bill_items ADD CONSTRAINT pos_bill_items_discount_source_check
    CHECK (discount_source IS NULL
           OR discount_source IN ('combo', 'coupon', 'manual', 'reward', 'partner'));
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 2 · สมุดร้าน
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS store_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(2000),

  type       VARCHAR(12) NOT NULL DEFAULT 'general'
    CHECK (type IN ('general', 'problem', 'todo', 'reminder', 'idea')),
  priority   VARCHAR(12) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'important', 'urgent')),
  visibility VARCHAR(16) NOT NULL DEFAULT 'owner_manager'
    CHECK (visibility IN ('owner_manager', 'store_team')),
  status     VARCHAR(12) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'archived')),

  -- มาจากไหน — ตัวกำหนดว่าจะเชื่อตัวตนผู้แจ้งได้แค่ไหน
  source     VARCHAR(16) NOT NULL DEFAULT 'owner'
    CHECK (source IN ('owner', 'manager', 'staff_app', 'pos_device')),

  -- พนักงานตัวจริงที่แจ้ง (พิสูจน์ผ่าน token เท่านั้น)
  reported_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  reporter_name           VARCHAR(120),

  -- บัญชี/เซสชันที่สร้างแถว — คนละเรื่องกับผู้แจ้ง
  created_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  resolved_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at             TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ⚠️ หัวใจของกฎตัวตน — บังคับที่ฐานข้อมูล ไม่ใช่แค่ในโค้ด
  -- แจ้งจากเครื่อง POS = พิสูจน์ตัวตนไม่ได้ → ห้ามมีชื่อผู้แจ้งเด็ดขาด
  CONSTRAINT store_notes_pos_anonymous_check CHECK (
    source <> 'pos_device'
    OR (reported_by_employee_id IS NULL AND reporter_name IS NULL)
  ),
  -- แจ้งจากแอปพนักงาน = ต้องรู้ว่าใคร ไม่งั้นไม่ใช่ staff_app
  CONSTRAINT store_notes_staff_identity_check CHECK (
    source <> 'staff_app' OR reported_by_employee_id IS NOT NULL
  ),
  -- ปิดเรื่องแล้วต้องมีเวลาปิด
  CONSTRAINT store_notes_resolved_check CHECK (
    status <> 'resolved' OR resolved_at IS NOT NULL
  )
);

-- หน้าสมุดร้าน: เรียงใหม่สุดก่อน กรองตามสถานะ
CREATE INDEX IF NOT EXISTS idx_store_notes_user
  ON store_notes (user_id, status, created_at DESC);
-- แยกของที่ทีมเห็นได้ออกจากของเจ้าของ
CREATE INDEX IF NOT EXISTS idx_store_notes_visibility
  ON store_notes (user_id, visibility, created_at DESC);
-- "รายการที่ฉันแจ้ง" ในแอปพนักงาน
CREATE INDEX IF NOT EXISTS idx_store_notes_reporter
  ON store_notes (reported_by_employee_id, created_at DESC)
  WHERE reported_by_employee_id IS NOT NULL;

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
--
-- 1) หุ้นส่วน 4 คนต่อร้าน
-- SELECT u.shop_name, COUNT(p.*) AS partners
-- FROM users u JOIN pos_partners p ON p.user_id = u.id GROUP BY u.shop_name;
--
-- 2) ค่าตั้งต้น — allow_below_cost ต้องเป็น false
-- SELECT partner_min_profit_per_item, partner_max_discount_percent,
--        partner_allow_below_cost FROM pos_shop_settings;
--
-- 3) discount_source รับ 'partner' แล้ว
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'pos_bill_items_discount_source_check';
--
-- 4) ยังไม่มีโน้ต (ถูกต้อง — สร้างจากหน้าเว็บ)
-- SELECT COUNT(*) FROM store_notes;
