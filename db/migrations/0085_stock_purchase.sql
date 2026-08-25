-- 0085_stock_purchase — เอกสารการซื้อ + หน่วยบรรจุ + กันรับซ้ำ
--
-- ═══ ที่มา (25 ส.ค. 2569) ═══════════════════════════════════════
-- ระบบเดิมรับของหลายรายการได้แล้ว (restockIngredientsBatch) แต่:
--   1) ไม่มีเอกสารการซื้อ — มีแค่ expense ก้อนเดียว ย้อนดูไม่ได้ว่าซื้ออะไรบ้าง
--   2) ไม่มีชื่อหีบห่อ — ซื้อ 3 แพ็คต้องกรอก 252 แผ่นเอง
--   3) ไม่มี idempotency — เน็ตหลุดแล้วกดซ้ำ = ของเข้า 2 เท่า (บั๊กที่มีอยู่จริงวันนี้)
--
-- ═══ สิ่งที่ "ไม่" ทำ (ยืนยันแล้ว) ═════════════════════════════
--   ✗ ไม่แตะ movement_type CHECK — ยังใช้ 'restock' เหมือนเดิม
--   ✗ ไม่เปลี่ยนวิธีคิดต้นทุน — ค่าเฉลี่ยถ่วงน้ำหนักเดิม
--   ✗ ไม่สร้าง expense category ใหม่ — ใช้ 'materials'
--   ✗ ไม่แตะ ingredients.purchase_unit / purchase_quantity / stock_qty
--   ✗ ไม่แตะสูตร การตัดสต็อกตอนขาย หรือ trigger 0076
--
-- ═══ หน่วยบรรจุทำงานยังไง ═══════════════════════════════════════
-- ingredients.purchase_unit คือ "หน่วยสต็อก" (แผ่น / g / ชิ้น) — ของเดิม ไม่ย้าย
-- ingredient_purchase_units เก็บ "หีบห่อ" ที่ตั้งชื่อได้ พร้อมตัวคูณ
--
--   ชีสแผ่น · หน่วยสต็อก = แผ่น
--     └── แพ็ค  ตัวคูณ 84   (default)
--     └── ลัง   ตัวคูณ 840
--
--   ซื้อ 3 แพ็ค → 3 × 84 = 252 แผ่น เข้าสต็อก
--
-- หน่วยสต็อกเองไม่ต้องมีแถว (ตัวคูณ = 1 เสมอ) UI เติมให้เอง
--
-- ═══ ย้อนกลับได้ไหม ═══════════════════════════════════════════
-- ตารางใหม่ 3 ตัว DROP ได้ · คอลัมน์ที่เพิ่มเป็น nullable ทั้งหมด
-- ข้อมูลเดิมไม่ถูกแก้แม้แต่แถวเดียว

BEGIN;

-- ═══ 1. เอกสารการซื้อ ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_no      VARCHAR(24) NOT NULL,              -- PUR-2026-0031
  supplier_name    VARCHAR(120),
  invoice_no       VARCHAR(60),
  business_date    DATE NOT NULL,                     -- ตัดวันตาม cutoff ของร้าน
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total    >= 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'received', 'cancelled')),
  payment_method   VARCHAR(20) NOT NULL DEFAULT 'cash',
  -- กันรับซ้ำตอนเน็ตหลุด — client ส่ง key เดิมมาตอน retry
  idempotency_key  VARCHAR(64),
  -- ประตูกันโพสต์ซ้ำ (แบบเดียวกับ payroll): UPDATE ... WHERE expense_entry_id IS NULL
  expense_entry_id UUID REFERENCES expense_entries(id) ON DELETE SET NULL,
  note             VARCHAR(255),
  created_by       UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at      TIMESTAMPTZ,
  -- ยอดต้องสอดคล้องกันเสมอ ไม่ว่าจะเขียนจากทางไหน
  CHECK (total = subtotal - discount),
  CHECK (discount <= subtotal)
);

-- เลขที่เอกสารห้ามซ้ำในร้านเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_purchases_doc
  ON stock_purchases (user_id, document_no);

-- หัวใจของ idempotency — retry ด้วย key เดิมจะชนตรงนี้ แล้วเราคืนของเดิม
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_purchases_idem
  ON stock_purchases (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_purchases_user_date
  ON stock_purchases (user_id, business_date DESC, created_at DESC);

-- ═══ 2. รายการในเอกสาร — snapshot ทั้งหมด ══════════════════════
-- เก็บชื่อ/หน่วย/ตัวคูณ ณ เวลาที่ซื้อ เพื่อให้ย้อนดูได้ถูกต้อง
-- แม้ภายหลังจะไปแก้ config ของวัตถุดิบ

CREATE TABLE IF NOT EXISTS stock_purchase_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_id         UUID NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  -- SET NULL ไม่ใช่ CASCADE — ลบวัตถุดิบแล้วประวัติการซื้อต้องยังอ่านได้
  ingredient_id       UUID REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name     VARCHAR(120) NOT NULL,          -- snapshot
  purchase_quantity   NUMERIC(14,4) NOT NULL CHECK (purchase_quantity > 0),
  purchase_unit_name  VARCHAR(30)   NOT NULL,         -- 'แพ็ค' หรือหน่วยสต็อกเอง
  conversion_factor   NUMERIC(14,4) NOT NULL CHECK (conversion_factor > 0),
  stock_quantity      NUMERIC(14,4) NOT NULL CHECK (stock_quantity > 0),
  stock_unit          VARCHAR(20)   NOT NULL,         -- snapshot ของ purchase_unit
  unit_price          NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_price  >= 0),
  total_price         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  cost_per_stock_unit NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (cost_per_stock_unit >= 0),
  qty_before          NUMERIC(14,4),
  qty_after           NUMERIC(14,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- การแปลงหน่วยต้องถูกเสมอ (เผื่อความคลาดเคลื่อนจากการปัด 4 ตำแหน่ง)
  CHECK (ABS(stock_quantity - purchase_quantity * conversion_factor) < 0.005),
  -- ยอดหลังต้องเท่ากับยอดก่อน + ที่รับเข้า (ตรวจได้เฉพาะแถวที่บันทึกไว้)
  CHECK (
    qty_before IS NULL OR qty_after IS NULL
    OR ABS(qty_after - (qty_before + stock_quantity)) < 0.005
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_purchase_items_purchase
  ON stock_purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_stock_purchase_items_ingredient
  ON stock_purchase_items (ingredient_id, created_at DESC);

-- ═══ 3. หน่วยบรรจุของวัตถุดิบ ═══════════════════════════════════
-- ทำเป็นตารางไม่ใช่คอลัมน์ เพื่อรองรับหลายหีบห่อต่อวัตถุดิบตั้งแต่แรก
-- (แพ็ค / ลัง / ถุงใหญ่) โดยไม่ต้องย้ายข้อมูลทีหลัง

CREATE TABLE IF NOT EXISTS ingredient_purchase_units (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id     UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  unit_name         VARCHAR(30) NOT NULL,
  conversion_factor NUMERIC(14,4) NOT NULL CHECK (conversion_factor > 0),
  is_default        BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ชื่อหน่วยห้ามซ้ำในวัตถุดิบเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS idx_ing_purchase_units_name
  ON ingredient_purchase_units (ingredient_id, unit_name);

-- default ได้ตัวเดียวต่อวัตถุดิบ — บังคับที่ฐานข้อมูล ไม่ใช่แค่ในโค้ด
CREATE UNIQUE INDEX IF NOT EXISTS idx_ing_purchase_units_default
  ON ingredient_purchase_units (ingredient_id)
  WHERE is_default AND is_active;

CREATE INDEX IF NOT EXISTS idx_ing_purchase_units_user
  ON ingredient_purchase_units (user_id, ingredient_id);

-- ═══ 4. เป้าหมายสต็อก ═══════════════════════════════════════════
-- NULL = ใช้การพยากรณ์จากอัตราการใช้จริงล้วน ๆ (พฤติกรรมเดิม 100%)
-- มีค่า = ใช้ค่าที่มากกว่าระหว่างพยากรณ์กับ (target - current)

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS target_stock NUMERIC(14,4);

-- ═══ 5. ผูกรายจ่ายกลับไปหาเอกสารการซื้อ ═════════════════════════

ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES stock_purchases(id) ON DELETE SET NULL;

-- 1 เอกสารการซื้อ = รายจ่ายได้ไม่เกิน 1 รายการ
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_entries_purchase
  ON expense_entries (purchase_id)
  WHERE purchase_id IS NOT NULL;

-- ═══ 6. movement เก็บยอดก่อน/หลัง + ผูกเอกสาร ═══════════════════
-- ทำให้ตรวจย้อนหลังได้ว่า 18 → +252 → 270 มาจากเอกสารไหน

ALTER TABLE ingredient_stock_movements
  ADD COLUMN IF NOT EXISTS qty_before  NUMERIC(14,4);
ALTER TABLE ingredient_stock_movements
  ADD COLUMN IF NOT EXISTS qty_after   NUMERIC(14,4);
ALTER TABLE ingredient_stock_movements
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES stock_purchases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredient_stock_movements_purchase
  ON ingredient_stock_movements (purchase_id);

-- ═══ 7. seed หน่วยบรรจุจากข้อมูลที่มีอยู่แล้ว ═══════════════════
-- ingredients.purchase_quantity บอกอยู่แล้วว่า "จ่ายราคานี้ได้ของเท่าไร"
--   ชีสแผ่น  หน่วย 'แผ่น' qty 84   → แพ็ค = 84 แผ่น
--   ซอสชีส   หน่วย 'g'    qty 1000 → กก.  = 1000 g
--   เนื้อ     หน่วย 'g'    qty 1    → ไม่ต้อง seed (ซื้อเป็นหน่วยสต็อกตรง ๆ)
--
-- ตั้งชื่อตามตระกูลหน่วย: g→กก. · ml→ลิตร · อื่น ๆ →แพ็ค
-- เจ้าของแก้ชื่อ/ตัวคูณ/เพิ่มลังทีหลังได้จากหน้าแก้วัตถุดิบ
-- รันซ้ำปลอดภัย: กันด้วย WHERE NOT EXISTS

INSERT INTO ingredient_purchase_units
  (user_id, ingredient_id, unit_name, conversion_factor, is_default)
SELECT
  i.user_id,
  i.id,
  CASE
    WHEN i.purchase_unit = 'g'  AND i.purchase_quantity = 1000 THEN 'กก.'
    WHEN i.purchase_unit = 'ml' AND i.purchase_quantity = 1000 THEN 'ลิตร'
    ELSE 'แพ็ค'
  END,
  i.purchase_quantity,
  true
FROM ingredients i
WHERE i.purchase_quantity > 1
  AND NOT EXISTS (
    SELECT 1 FROM ingredient_purchase_units u WHERE u.ingredient_id = i.id
  );

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
--
-- 1) ตารางใหม่ครบ 3 ตัว
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('stock_purchases','stock_purchase_items','ingredient_purchase_units');
--
-- 2) หน่วยบรรจุที่ seed ให้ — ตรวจว่าชีสได้ 'แพ็ค = 84'
-- SELECT i.name, i.purchase_unit AS หน่วยสต็อก,
--        u.unit_name AS หน่วยซื้อ, u.conversion_factor AS ตัวคูณ
-- FROM ingredient_purchase_units u
-- JOIN ingredients i ON i.id = u.ingredient_id
-- ORDER BY i.name;
--
-- 3) ยังไม่มีเอกสารการซื้อ (ถูกต้อง — สร้างจากหน้าเว็บ)
-- SELECT COUNT(*) FROM stock_purchases;
