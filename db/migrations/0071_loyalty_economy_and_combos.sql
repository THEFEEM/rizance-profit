-- 0071 — Loyalty Economy (คืนลูกค้า 8%) + Combo + Gross/Discount/Net
--
-- ตัดสินใจทางธุรกิจที่รองรับ (6 ส.ค. 2569):
--   1) คืนมูลค่าให้ลูกค้า 8% ของยอดสุทธิ (ปรับได้ 5 / 8 / 13 จาก Admin)
--   2) ส่วนลด/คูปอง = "ลดรายได้" (Revenue Reduction) ไม่ใช่ค่าการตลาด
--   3) Point Economy ต้องตั้งค่าได้ ห้าม hard-code
--
-- ⚠️ invariant บัญชีเดิมยังต้องจริงทุกตัวอักษร:
--    Σ pos_bill_items.line_total = pos_bills.total_amount = journal debit = credit
--    migration นี้ "ไม่" เพิ่มบรรทัดส่วนลดแยก และ "ไม่" แตะ total_amount

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 1 · POINT ECONOMY แบบตั้งค่าได้
-- ═══════════════════════════════════════════════════════════════
--
-- เดิม: baht_per_point (ซื้อครบ N บาท = 1 แต้ม) — คิดจากฝั่ง "แต้ม" ไม่ใช่ฝั่ง "มูลค่า"
--       ทำให้ตอบไม่ได้ว่าโครงการนี้คืนเงินลูกค้ากี่ % ของยอดขาย
--
-- ใหม่: คิดจาก "มูลค่าที่คืนให้ลูกค้า" ก่อน แล้วค่อยแปลงเป็นแต้ม
--
--   แต้มที่ได้ = floor( net_sales × loyalty_return_pct/100 ÷ (point_value_satang/100) )
--
--   ตัวอย่างที่ตกลงกัน: บิล ฿100 · คืน 8% · 1 แต้ม = 10 สตางค์
--     มูลค่าที่คืน = ฿8.00  →  8.00 ÷ 0.10 = 80 แต้ม
--     ลูกค้าเห็น "ได้ 80 แต้ม" (ตัวเลขสวย) ร้านรู้ว่าจ่ายไป ฿8 (8%)
--
--   รางวัล Wrap Z ฿65 → ต้องใช้ 650 แต้ม → ลูกค้าต้องซื้อรวม ฿812
--   (650 แต้ม × ฿0.10 = ฿65 ตรงกับต้นทุนรางวัลพอดี → คืนจริง 8% เป๊ะ)
--
-- ⚠️ แต้มเปลี่ยน "ความหมาย" จากของเดิม (เดิม 1 แต้ม = ซื้อครบ ฿5)
--    ตอนนี้มีสมาชิก 1 คน 11 แต้ม → ผลกระทบเป็นศูนย์ นี่คือจังหวะที่ถูกต้องที่สุดที่จะเปลี่ยน
--    baht_per_point ไม่ถูกลบ (กฎ additive) แต่เลิกใช้ในการคำนวณแล้ว

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS loyalty_return_pct NUMERIC(5, 2) NOT NULL DEFAULT 8.00;
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS point_value_satang INTEGER NOT NULL DEFAULT 10;
-- true = ใช้สูตรใหม่ · false = ใช้ baht_per_point แบบเดิม (ปุ่มถอยกลับถ้าเจอปัญหาหน้างาน)
ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS loyalty_use_pct BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_loyalty_pct_check') THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_loyalty_pct_check
      -- เพดาน 20%: เกินกว่านี้คือแจกจนขาดทุน ไม่ใช่โปรโมชั่น
      CHECK (loyalty_return_pct >= 0 AND loyalty_return_pct <= 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shop_settings_point_value_check') THEN
    ALTER TABLE pos_shop_settings ADD CONSTRAINT pos_shop_settings_point_value_check
      CHECK (point_value_satang >= 1 AND point_value_satang <= 10000);
  END IF;
END $$;

-- เกณฑ์แลกรางวัลเดิมจำกัด 1..100000 อยู่แล้ว — พอสำหรับ 650 แต้ม ไม่ต้องแก้

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 2 · GROSS / DISCOUNT / NET  — คอลัมน์เดียวที่ตอบได้ทั้งชีวิต
-- ═══════════════════════════════════════════════════════════════
--
-- ปัญหา: ตอนนี้บิลเก็บแต่ "ราคาที่ขายจริง" → ถามไม่ได้ว่าแจกส่วนลดไปเท่าไหร่
--
-- วิธีที่เลือก: เก็บ "ราคาป้าย" คู่กับ "ราคาที่ขายจริง" ในบรรทัดเดียวกัน
--   list_unit_price = ราคาปกติของสินค้า ณ ตอนขาย (snapshot)
--   unit_sell_price = ราคาที่เก็บเงินจริง (คอลัมน์เดิม ไม่แตะ)
--
--   Gross Sales = Σ list_unit_price × quantity
--   Discount    = Gross − Net
--   Net Sales   = Σ line_total = total_amount   ← invariant เดิม ยังจริง
--
-- ทำไมไม่เพิ่ม "บรรทัดส่วนลด" ติดลบในบิล:
--   จะทำให้ Σ line_total ยังเท่ากับ total_amount ก็จริง แต่รายงานสินค้าขายดี
--   และการตัดสต๊อกจะต้องข้ามบรรทัดพิเศษทุกที่ที่มีการ JOIN — เปราะและลืมง่าย
--   เก็บเป็นคอลัมน์คู่ ทำให้ทุก query เดิมทำงานเหมือนเดิมโดยไม่ต้องแก้เลยแม้แต่บรรทัดเดียว
--
-- NULL = บิลเก่าก่อน migration นี้ (ถือว่าไม่มีส่วนลด → COALESCE เป็น unit_sell_price)

ALTER TABLE pos_bill_items
  ADD COLUMN IF NOT EXISTS list_unit_price NUMERIC(12, 2);

COMMENT ON COLUMN pos_bill_items.list_unit_price IS
  'ราคาป้าย ณ ตอนขาย (snapshot) · NULL = ไม่มีส่วนลด · Gross = Σ COALESCE(list_unit_price, unit_sell_price) × quantity';

-- แหล่งที่มาของส่วนลด — ใช้แยกรายงานว่าคอมโบ/คูปองแจกไปเท่าไหร่
ALTER TABLE pos_bill_items
  ADD COLUMN IF NOT EXISTS discount_source VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_bill_items_discount_source_check') THEN
    ALTER TABLE pos_bill_items ADD CONSTRAINT pos_bill_items_discount_source_check
      CHECK (discount_source IS NULL OR discount_source IN ('combo', 'coupon', 'manual', 'reward'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_bill_items_discount
  ON pos_bill_items (discount_source)
  WHERE discount_source IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 3 · COMBO
-- ═══════════════════════════════════════════════════════════════
--
-- ที่มา: บิลเฉลี่ย ฿71 = เกือบทุกบิลคือเบอร์เกอร์ 1 ชิ้น
--        เฟรนฟราย ฿59 มีในเมนูแต่ไม่เคยติดอันดับขายดีเลย
--        คอมโบคือตัวเดียวที่ให้ "เหตุผล" ลูกค้าสั่งเกิน 1 ชิ้น
--
-- ⚠️ คอมโบเข้าบิลอย่างไร (สำคัญที่สุดในไฟล์นี้):
--    คอมโบ "ไม่" เป็นบรรทัดเดียวราคาเดียว แต่ "กระจายเป็นบรรทัดสินค้าจริง"
--    พร้อมราคาที่ถูกลดตามสัดส่วน
--
--    Smash M ฿69 + ฟราย ฿35 + น้ำ ฿35 = ป้าย ฿139 → คอมโบ ฿109
--      Smash M : list 69.00 → sell 54.11
--      ฟราย    : list 35.00 → sell 27.44
--      น้ำ     : list 35.00 → sell 27.45   ← บรรทัดสุดท้ายรับเศษ
--                                   รวม = 109.00 พอดี
--
--    ทำแบบนี้เพราะ:
--      ✓ ตัดสต๊อก/วัตถุดิบรายสินค้าได้เหมือนเดิม
--      ✓ รายงานสินค้าขายดีนับฟรายและน้ำได้จริง (ไม่หายเข้าไปในคำว่า "คอมโบ")
--      ✓ Σ line_total = total_amount ยังจริง → journal ไม่ต้องแก้แม้แต่บรรทัดเดียว
--      ✓ Gross/Discount แยกได้จาก list_unit_price ที่เพิ่งเพิ่ม

CREATE TABLE IF NOT EXISTS pos_combos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  image_url   TEXT,
  -- ราคาคอมโบที่ลูกค้าจ่ายจริง (ราคาป้ายรวมคำนวณจากสินค้าในคอมโบ ณ เวลาแสดงผล)
  combo_price NUMERIC(12, 2) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_combos_price_positive') THEN
    ALTER TABLE pos_combos ADD CONSTRAINT pos_combos_price_positive CHECK (combo_price > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_combos_window_valid') THEN
    ALTER TABLE pos_combos ADD CONSTRAINT pos_combos_window_valid
      CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_combos_user_active
  ON pos_combos (user_id, is_active, sort_order);

-- สินค้าในคอมโบ
-- product_id ผูก FK แบบ RESTRICT: ลบสินค้าที่อยู่ในคอมโบไม่ได้ ต้องเอาออกจากคอมโบก่อน
-- (ต่างจาก pos_bill_items ที่ต้อง SET NULL เพราะบิลคือประวัติที่ห้ามหาย)
CREATE TABLE IF NOT EXISTS pos_combo_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id   UUID NOT NULL REFERENCES pos_combos(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES pos_products(id) ON DELETE RESTRICT,
  quantity   NUMERIC(12, 3) NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_combo_items_qty_positive') THEN
    ALTER TABLE pos_combo_items ADD CONSTRAINT pos_combo_items_qty_positive CHECK (quantity > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_combo_items_combo
  ON pos_combo_items (combo_id, sort_order);
-- กันใส่สินค้าเดิมซ้ำในคอมโบเดียวกัน (ถ้าต้องการ 2 ชิ้น ให้ใช้ quantity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_combo_items_unique
  ON pos_combo_items (combo_id, product_id);

-- บิล/ออเดอร์รู้ว่าบรรทัดนี้มาจากคอมโบใบไหน
-- ไม่ผูก FK: คอมโบอาจถูกลบทีหลัง แต่บิลต้องคงประวัติไว้ (แนวเดียวกับ journal source_event_id)
ALTER TABLE pos_bill_items  ADD COLUMN IF NOT EXISTS combo_id UUID;
ALTER TABLE pos_bill_items  ADD COLUMN IF NOT EXISTS combo_name VARCHAR(120);
ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS combo_id UUID;
ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS combo_name VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_pos_bill_items_combo
  ON pos_bill_items (combo_id) WHERE combo_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- ส่วนที่ 4 · UPSELL — สินค้า A ควรแนะนำ B
-- ═══════════════════════════════════════════════════════════════
-- เล็กมากแต่ใส่ตอนนี้เลยเพราะเป็นตารางเดียว และเป็นตัวที่ทำให้ฟรายขายได้
CREATE TABLE IF NOT EXISTS pos_upsell_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = ใช้กับทุกสินค้า (แนะนำท้ายตะกร้าเสมอ)
  trigger_product_id UUID REFERENCES pos_products(id) ON DELETE CASCADE,
  suggest_product_id UUID NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
  headline          VARCHAR(120),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_upsell_no_self') THEN
    ALTER TABLE pos_upsell_rules ADD CONSTRAINT pos_upsell_no_self
      CHECK (trigger_product_id IS NULL OR trigger_product_id <> suggest_product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_upsell_user
  ON pos_upsell_rules (user_id, is_active, sort_order);

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- ตรวจหลังรัน — ทุกข้อต้องได้ค่าที่ระบุ
-- ═══════════════════════════════════════════════════════════════
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'
--      AND table_name IN ('pos_combos','pos_combo_items','pos_upsell_rules'))        AS tables_3,
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
--      AND table_name='pos_shop_settings'
--      AND column_name IN ('loyalty_return_pct','point_value_satang','loyalty_use_pct')) AS settings_3,
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
--      AND table_name='pos_bill_items'
--      AND column_name IN ('list_unit_price','discount_source','combo_id','combo_name')) AS billitem_4;
-- ต้องได้ 3, 3, 4
--
-- invariant เดิมต้องยังจริง (ต้องได้ 0 แถว):
-- SELECT b.bill_no FROM pos_bills b JOIN pos_bill_items bi ON bi.bill_id=b.id
-- WHERE b.status='paid' GROUP BY b.id, b.bill_no, b.total_amount
-- HAVING b.total_amount <> SUM(bi.line_total);
