-- 0094_pos_gift_vouchers — Rizance Digital Gift Voucher Engine
--
-- ที่มา: AUDIT-gift-voucher.md (4 ก.ย. 69) — decision A ทั้ง 5 ข้อ
--
-- ═══ การตัดสินใจที่ฝังในสคีมา ═══════════════════════════════════════
--
-- 1) Tenant = users.id เหมือนทุกตาราง pos_* ("business_id" ในสเปก = user_id)
--    ไม่มี RLS ในระบบนี้ → tenant isolation บังคับที่ query (user_id ทุกครั้ง)
--
-- 2) Voucher = ส่วนลด (Revenue Reduction) ฝังในราคาบรรทัดผ่าน
--    list_unit_price + discount_source='voucher' (ทางเดียวกับ coupon 0074 / partner 0086)
--    → ไม่แตะ payments / journal / cash closing
--
-- 3) Token 2 ชั้น: public_code (อ่านออกเสียงได้ ไม่ลับ) + token (ลับ, เก็บเฉพาะ sha256)
--    QR = URL ที่มี token · DB ไม่มี raw token → หลุด DB ก็ปลอม QR ไม่ได้
--
-- 4) Redeem ต้อง atomic: UPDATE ... WHERE status='active' RETURNING + UNIQUE(voucher_id)
--    ใน redemptions เป็นชั้นที่สอง · ทั้งหมดอยู่ใน transaction เดียวกับบิล
--
-- 5) 'expired' ไม่เป็น status ใน DB (คำนวณจาก expires_at ตอนอ่าน — ไม่มี cron เหมือน 0074)
--    แต่ CHECK ยอมรับค่านี้ไว้เผื่อ backfill ในอนาคต
--
-- 6) Branch: เก็บ allowed_branch_ids / redeemed_branch_id ไว้ก่อน ยังไม่บังคับ
--    (POS ไม่มี branch context — BLOCKER-2 A)
--
-- 7) 1 บิล = 1 voucher · ห้ามซ้อน coupon/partner (บังคับใน closePosBill)
--
-- Additive + idempotent · ไม่แตะแถวเดิม · ไม่ reset ข้อมูล

BEGIN;

-- ── 1) แคมเปญ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_voucher_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500),
  sponsor       VARCHAR(120),

  voucher_type  VARCHAR(20) NOT NULL DEFAULT 'fixed_amount',
  -- fixed_amount: บาท · percentage: 0–100 · อื่น ๆ เผื่ออนาคต (engine ปฏิเสธถ้าเจอ)
  value         NUMERIC(12,2) NOT NULL,

  -- จำนวนที่ตั้งใจออก (แผน) — จำนวนจริงนับจาก pos_vouchers
  quantity_planned INTEGER,
  -- MVP = 1 (ใช้ครั้งเดียวทั้งใบ) · เก็บไว้เผื่อ store_credit
  usage_limit_per_voucher INTEGER NOT NULL DEFAULT 1,

  start_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,

  status        VARCHAR(20) NOT NULL DEFAULT 'draft',

  -- prefix ของ public_code เช่น NAL26 → NAL26-0001
  code_prefix   VARCHAR(12) NOT NULL,

  terms         TEXT,
  -- template / สี / โลโก้ / hero — ดู lib/pos-voucher-schema.ts
  design_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- NULL = ทุกสาขา · ยังไม่ enforce (BLOCKER-2 A)
  allowed_branch_ids UUID[],

  created_by    VARCHAR(10) NOT NULL DEFAULT 'owner',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_campaigns_status_check') THEN
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'ended', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_campaigns_type_check') THEN
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_type_check
      CHECK (voucher_type IN ('fixed_amount', 'percentage', 'free_item', 'buy_x_get_y', 'store_credit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_campaigns_value_check') THEN
    ALTER TABLE pos_voucher_campaigns ADD CONSTRAINT pos_voucher_campaigns_value_check
      CHECK (
        value > 0
        AND (voucher_type <> 'percentage' OR value <= 100)
        AND (quantity_planned IS NULL OR quantity_planned > 0)
        AND usage_limit_per_voucher > 0
        AND expires_at > start_at
        AND code_prefix ~ '^[A-Z0-9]{2,12}$'
        AND created_by IN ('owner')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_voucher_campaigns_user_status
  ON pos_voucher_campaigns (user_id, status, created_at DESC);

-- ── 2) ใบ voucher ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_vouchers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES pos_voucher_campaigns(id) ON DELETE CASCADE,

  -- อ่านออกเสียงได้ · ไม่ลับ · ใช้ค้นหา
  public_code   VARCHAR(32) NOT NULL,
  -- sha256 hex ของ token ลับ (rzv_...) — pattern เดียวกับ employees.token_hash (0077)
  token_hash    CHAR(64) NOT NULL,

  status        VARCHAR(20) NOT NULL DEFAULT 'active',

  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at  TIMESTAMPTZ,
  redeemed_at   TIMESTAMPTZ,
  -- ไม่มี FK ตาม pattern usages/point_events — ลบบิลไม่ทำให้ประวัติ voucher หาย
  redeemed_bill_id   UUID,
  redeemed_branch_id UUID,

  -- customer wallet ในอนาคต (My Rewards)
  member_id     UUID REFERENCES pos_members(id) ON DELETE SET NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, public_code)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_vouchers_status_check') THEN
    ALTER TABLE pos_vouchers ADD CONSTRAINT pos_vouchers_status_check
      CHECK (status IN ('issued', 'active', 'redeemed', 'expired', 'cancelled', 'blocked'));
  END IF;
  -- redeemed ต้องมีเวลา+บิลเสมอ · ไม่ redeemed ต้องไม่มี
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_vouchers_redeemed_check') THEN
    ALTER TABLE pos_vouchers ADD CONSTRAINT pos_vouchers_redeemed_check
      CHECK (
        (status = 'redeemed' AND redeemed_at IS NOT NULL AND redeemed_bill_id IS NOT NULL)
        OR (status <> 'redeemed' AND redeemed_at IS NULL AND redeemed_bill_id IS NULL)
      );
  END IF;
END $$;

-- token_hash ต้อง unique ทั้งระบบ (public lookup ไม่รู้ user_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_vouchers_token_hash
  ON pos_vouchers (token_hash);
-- รายการในแคมเปญ + filter สถานะ (หน้า Vouchers tab)
CREATE INDEX IF NOT EXISTS idx_pos_vouchers_campaign_status
  ON pos_vouchers (campaign_id, status, issued_at DESC);
-- ค้นหา code ภายในร้าน (prefix search)
CREATE INDEX IF NOT EXISTS idx_pos_vouchers_user_code
  ON pos_vouchers (user_id, public_code);
-- analytics: ใช้เมื่อไร
CREATE INDEX IF NOT EXISTS idx_pos_vouchers_redeemed
  ON pos_vouchers (campaign_id, redeemed_at)
  WHERE redeemed_at IS NOT NULL;

-- ── 3) ประวัติการใช้ (append-only — ห้าม UPDATE/DELETE) ───────────
CREATE TABLE IF NOT EXISTS pos_voucher_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voucher_id    UUID NOT NULL REFERENCES pos_vouchers(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES pos_voucher_campaigns(id) ON DELETE CASCADE,

  bill_id       UUID,
  bill_no       VARCHAR(32),
  branch_id     UUID,
  -- พนักงานที่กดปิดบิล — NULL เมื่อเจ้าของกดเอง
  employee_id   UUID REFERENCES employees(id) ON DELETE SET NULL,

  order_subtotal     NUMERIC(12,2) NOT NULL,   -- ยอดก่อนหัก voucher
  voucher_face_value NUMERIC(12,2) NOT NULL,   -- มูลค่าหน้าบัตร
  voucher_amount     NUMERIC(12,2) NOT NULL,   -- ที่หักจริง (≤ face, ≤ subtotal)
  final_total        NUMERIC(12,2) NOT NULL,   -- ที่ลูกค้าจ่าย

  redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_redemptions_math_check') THEN
    ALTER TABLE pos_voucher_redemptions ADD CONSTRAINT pos_voucher_redemptions_math_check
      CHECK (
        voucher_amount >= 0
        AND voucher_amount <= voucher_face_value
        AND voucher_amount <= order_subtotal
        AND final_total = order_subtotal - voucher_amount
        AND final_total >= 0
      );
  END IF;
END $$;

-- ชั้นที่ 2 ของ double-redeem protection: 1 ใบ redeem ได้ครั้งเดียวตลอดชีวิต
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_voucher
  ON pos_voucher_redemptions (voucher_id);
-- 1 บิล 1 voucher
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_bill
  ON pos_voucher_redemptions (bill_id)
  WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_voucher_redemptions_campaign
  ON pos_voucher_redemptions (campaign_id, redeemed_at DESC);

-- ── 4) audit events (append-only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS pos_voucher_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   UUID REFERENCES pos_voucher_campaigns(id) ON DELETE CASCADE,
  voucher_id    UUID REFERENCES pos_vouchers(id) ON DELETE CASCADE,

  actor         VARCHAR(10) NOT NULL,
  action        VARCHAR(40) NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_voucher_events_actor_check') THEN
    ALTER TABLE pos_voucher_events ADD CONSTRAINT pos_voucher_events_actor_check
      CHECK (actor IN ('owner', 'staff', 'public', 'system'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_voucher_events_campaign
  ON pos_voucher_events (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_voucher_events_voucher
  ON pos_voucher_events (voucher_id, created_at DESC)
  WHERE voucher_id IS NOT NULL;

-- ── 5) เชื่อมกับบิล ─────────────────────────────────────────────
-- snapshot ลิงก์ย้อนกลับ (ประวัติบิลโชว์ "ใช้ voucher NAL26-0001")
ALTER TABLE pos_bills
  ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES pos_vouchers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pos_bills_voucher
  ON pos_bills (voucher_id)
  WHERE voucher_id IS NOT NULL;

-- discount_source += 'voucher' (additive — ค่าเดิมทั้ง 5 ใช้ได้เหมือนเดิม)
-- หาชื่อ constraint จาก catalog เหมือน 0086 แทนการเดาชื่อ
DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'pos_bill_items'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%combo%'
    AND pg_get_constraintdef(oid) LIKE '%partner%';
  IF con IS NOT NULL AND pg_get_constraintdef(
       (SELECT oid FROM pg_constraint WHERE conname = con AND conrelid = 'pos_bill_items'::regclass)
     ) NOT LIKE '%voucher%' THEN
    EXECUTE format('ALTER TABLE pos_bill_items DROP CONSTRAINT %I', con);
    ALTER TABLE pos_bill_items ADD CONSTRAINT pos_bill_items_discount_source_check
      CHECK (discount_source IS NULL
             OR discount_source IN ('combo', 'coupon', 'manual', 'reward', 'partner', 'voucher'));
  END IF;
END $$;

-- ── self-check ──────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_name IN ('pos_voucher_campaigns','pos_vouchers',
                           'pos_voucher_redemptions','pos_voucher_events')) <> 4 THEN
    RAISE EXCEPTION '0094: voucher tables missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pos_vouchers_token_hash') THEN
    RAISE EXCEPTION '0094: token_hash unique index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pos_voucher_redemptions_voucher') THEN
    RAISE EXCEPTION '0094: redemption unique index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pos_bill_items'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%voucher%') THEN
    RAISE EXCEPTION '0094: discount_source voucher not allowed';
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน (บน Supabase)
-- ══════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'pos_voucher%';
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'pos_bill_items'::regclass AND conname = 'pos_bill_items_discount_source_check';
-- SELECT count(*) FROM pos_bills;   -- ต้องเท่าก่อนรัน
