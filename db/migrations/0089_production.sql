-- ══════════════════════════════════════════════════════════════════
-- 0089 — วัตถุดิบที่ร้านผลิตเอง (Homemade Sauce / Cheese Sauce)
--
-- ═══ สิ่งที่ทำ ═══════════════════════════════════════════════════
--   ซื้อวัตถุดิบ → รับเข้าคลัง → ผลิตซอส → ตัดวัตถุดิบ → ซอสเข้าสต็อก
--   → ขายเบอร์เกอร์ → ตัดซอสตามสูตร → รู้ว่าใช้ไปกี่กรัม เหลือกี่วัน
--
-- ═══ สิ่งที่ตั้งใจไม่ทำ ═══════════════════════════════════════════
--   ✗ ไม่สร้างตาราง produced_ingredients แยก
--     ซอสยังเป็นแถวใน ingredients เหมือนวัตถุดิบทั่วไป จึงได้ stock_qty ·
--     avg_cost · low stock · target stock · สูตร POS · movement · ตรวจนับ
--     · รายงาน มาฟรีทั้งหมดโดยไม่ต้องเขียนโค้ดใหม่
--   ✗ ไม่สร้างระบบสต็อกชุดที่สอง — reuse ingredient_stock_movements เดิม
--   ✗ ไม่แตะ closePosBill / void / weighted average — ทำงานกับซอสได้อยู่แล้ว
--   ✗ ไม่ลงรายจ่ายใหม่ตอนผลิต — ค่าวัตถุดิบถูกบันทึกเป็นรายจ่ายตอน "ซื้อ"
--     ไปแล้ว ลงอีกครั้งตอนผลิต = นับซ้ำ งบกำไรขาดทุนจะเพี้ยน
--     การผลิตคือการ "ย้ายมูลค่า" จากวัตถุดิบไปเป็นซอส ไม่ใช่ค่าใช้จ่ายใหม่
--
-- ═══ หน่วย ═══════════════════════════════════════════════════════
--   production_recipe_items.quantity  = หน่วยใช้งาน (กรัม/มล./ชิ้น)
--                                       รูปแบบเดียวกับ pos_product_ingredients
--   production_batch_items.*_qty      = หน่วยสต็อก (แปลงแล้ว)
--                                       รูปแบบเดียวกับ applyReceiveLine
--   แปลงด้วย fn_recipe_qty_in_purchase_unit() จาก 0088
--
-- ═══ invariant ที่ DB บังคับให้ (ระดับแถว) ════════════════════════
--   · ผลิตเสร็จแล้วต้องมีผลผลิตจริง ต้นทุน และเวลาที่เสร็จ
--   · ต้นทุนบรรทัด = ปริมาณที่ใช้จริง × ต้นทุนต่อหน่วย ณ วันผลิต
--   · ต้นทุนต่อหน่วยผลผลิต × ผลผลิตจริง = ต้นทุนรวมของใบผลิต
--   · วัตถุดิบต้องไม่ใช่ตัวมันเอง (ซอสทำจากซอสตัวเดียวกันไม่ได้)
--
--   Σ ของบรรทัด = ยอดรวมใบผลิต บังคับใน transaction ฝั่ง server
--   ตามแบบเดียวกับ 0080 (payroll) ไม่ใช้ trigger ข้ามตาราง
--
-- ⚠️ additive ล้วน · ไม่ลบ ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1 · วัตถุดิบมาจากไหน ═════════════════════════════════════════
--
-- ทำไมไม่ใช้ category ที่มีอยู่แล้ว:
--   category = "หมวดของ" (เนื้อ/ขนมปัง/ผัก/ซอส/บรรจุภัณฑ์) เป็นข้อความอิสระ
--   Mayo กับ Ketchup ก็อยู่หมวด "ซอส" แต่ซื้อมา ไม่ได้ผลิตเอง
--   kind = "แหล่งกำเนิดของสต็อก" คนละความหมาย ปนกันไม่ได้

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'purchased';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_kind_check') THEN
    ALTER TABLE ingredients ADD CONSTRAINT ingredients_kind_check
      CHECK (kind IN ('purchased', 'produced'));
  END IF;
END $$;

-- ของเดิมทั้งหมดคือของที่ซื้อมา — DEFAULT จัดการให้แล้ว ไม่ต้อง UPDATE

CREATE INDEX IF NOT EXISTS idx_ingredients_kind
  ON ingredients (user_id, kind);


-- ═══ 2 · สูตรผลิต — ค่าปัจจุบัน แก้ได้ตลอด ════════════════════════
--
-- ไม่เก็บ output_unit ซ้ำ เพราะ ingredients.purchase_unit ของตัวผลผลิต
-- เป็นเจ้าของความจริงอยู่แล้ว เก็บสองที่ = วันหนึ่งจะไม่ตรงกัน
-- (ส่วนใบผลิตเก็บ snapshot หน่วยไว้ เพราะเป็นประวัติ ห้ามขยับ)

CREATE TABLE IF NOT EXISTS production_recipes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  output_ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  name                 VARCHAR(120) NOT NULL,
  -- คำนำหน้าเลขใบผลิต เช่น 'HM' → HM-20260827-001
  batch_prefix         VARCHAR(8) NOT NULL DEFAULT 'PRD',
  -- ผลิต 1 รอบได้เท่าไร (หน่วยสต็อกของตัวผลผลิต)
  expected_output_qty  NUMERIC(14,4) NOT NULL CHECK (expected_output_qty > 0),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  note                 VARCHAR(255),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- ซอสหนึ่งตัวมีสูตรที่ใช้งานอยู่ได้แค่สูตรเดียว — ไม่งั้น "ผลิตซอสนี้"
-- จะกำกวมว่าใช้สูตรไหน · ถ้าวันหน้าต้องการหลายสูตร ค่อยเพิ่ม is_default
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_recipes_active_output
  ON production_recipes (user_id, output_ingredient_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_production_recipes_user
  ON production_recipes (user_id, is_active);


CREATE TABLE IF NOT EXISTS production_recipe_items (
  recipe_id     UUID NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  -- หน่วยใช้งาน (กรัม/มล./ชิ้น) — รูปแบบเดียวกับ pos_product_ingredients
  quantity      NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_production_recipe_items_ingredient
  ON production_recipe_items (ingredient_id);

-- ซอสทำจากตัวมันเองไม่ได้ — CHECK ข้ามตารางไม่ได้ จึงใช้ trigger
-- (ถ้าปล่อยไว้ ผลิตครั้งเดียวจะหักตัวเองแล้วเพิ่มตัวเอง ตัวเลขมั่วทันที)
CREATE OR REPLACE FUNCTION fn_production_recipe_no_self() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM production_recipes r
    WHERE r.id = NEW.recipe_id AND r.output_ingredient_id = NEW.ingredient_id
  ) THEN
    RAISE EXCEPTION 'production_recipe_self_reference'
      USING HINT = 'วัตถุดิบในสูตรต้องไม่ใช่ตัวผลผลิตเอง';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_production_recipe_no_self ON production_recipe_items;
CREATE TRIGGER trg_production_recipe_no_self
  BEFORE INSERT OR UPDATE ON production_recipe_items
  FOR EACH ROW EXECUTE FUNCTION fn_production_recipe_no_self();


-- ═══ 3 · ใบผลิต — ประวัติ ห้ามขยับตามสูตรที่เปลี่ยนทีหลัง ══════════

CREATE TABLE IF NOT EXISTS production_batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ลบสูตรทิ้งแล้วใบผลิตเก่าต้องยังอ่านได้ → SET NULL + snapshot ชื่อไว้
  recipe_id            UUID REFERENCES production_recipes(id) ON DELETE SET NULL,
  output_ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,

  batch_no             VARCHAR(32) NOT NULL,
  business_date        DATE NOT NULL,

  -- ── snapshot ณ วันผลิต — เปลี่ยนชื่อสูตรวันนี้ ไม่แตะใบเมื่อวาน ──
  recipe_name          VARCHAR(120) NOT NULL,
  output_name          VARCHAR(120) NOT NULL,
  output_unit          VARCHAR(20)  NOT NULL,

  -- ผลิตกี่รอบ (1 / 2 / 3 batch)
  multiplier           NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  -- ตามสูตร × multiplier
  expected_output_qty  NUMERIC(14,4) NOT NULL CHECK (expected_output_qty > 0),
  -- ชั่งได้จริง (NULL จนกว่าจะผลิตเสร็จ) — 0 ได้ กรณีเสียทั้งหม้อ
  actual_output_qty    NUMERIC(14,4) CHECK (actual_output_qty IS NULL OR actual_output_qty >= 0),

  -- Σ ต้นทุนวัตถุดิบที่ใช้จริง
  total_cost           NUMERIC(12,2) CHECK (total_cost IS NULL OR total_cost >= 0),
  -- total_cost ÷ actual_output_qty — ต้นทุนซอสต่อหน่วย
  -- ใช้ผลผลิต "จริง" ไม่ใช่ที่คาดไว้ ของเสียระหว่างผลิตจึงดันต้นทุนขึ้นตามจริง
  unit_cost            NUMERIC(12,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),

  status               VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'cancelled')),

  -- กันกดยืนยันซ้ำตอนเน็ตกระตุก (รูปแบบเดียวกับ stock_purchases 0085)
  idempotency_key      VARCHAR(64),

  note                 VARCHAR(255),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, batch_no),

  -- ── invariant ระดับแถว ──
  -- ผลิตเสร็จ = ต้องรู้ครบว่าได้เท่าไร ต้นทุนเท่าไร เสร็จเมื่อไร
  CONSTRAINT production_batches_completed_check CHECK (
    status <> 'completed'
    OR (actual_output_qty IS NOT NULL
        AND total_cost   IS NOT NULL
        AND completed_at IS NOT NULL)
  ),
  -- มีผลผลิตจริง = ต้องมีต้นทุนต่อหน่วย · ไม่มีผลผลิต = ห้ามมี
  -- (ชื่อต้องไม่ใช่ production_batches_unit_cost_check — Postgres จองชื่อนั้น
  --  ให้ CHECK ระดับคอลัมน์ของ unit_cost ไปแล้วโดยอัตโนมัติ)
  CONSTRAINT production_batches_unit_cost_required_check CHECK (
    status <> 'completed'
    OR (actual_output_qty > 0) = (unit_cost IS NOT NULL)
  ),
  -- ต้นทุนต่อหน่วย × ผลผลิตจริง ต้องเท่ากับต้นทุนรวม (เผื่อปัดเศษ 1 สตางค์)
  CONSTRAINT production_batches_cost_math_check CHECK (
    status <> 'completed'
    OR actual_output_qty IS NULL OR actual_output_qty = 0
    OR ABS(unit_cost * actual_output_qty - total_cost) <= 0.01
  ),
  -- ยกเลิกแล้วห้ามมีผลผลิตค้างอยู่
  CONSTRAINT production_batches_cancelled_check CHECK (
    status <> 'cancelled' OR actual_output_qty IS NULL
  )
);

-- idempotency: คีย์เดิม = ใบเดิม ไม่ผลิตซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_batches_idem
  ON production_batches (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_batches_user_date
  ON production_batches (user_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_batches_output
  ON production_batches (output_ingredient_id, business_date DESC);


CREATE TABLE IF NOT EXISTS production_batch_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  -- ลบวัตถุดิบทิ้งแล้วใบผลิตเก่าต้องยังอ่านได้ → SET NULL + snapshot ชื่อไว้
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE SET NULL,

  -- ── snapshot ณ วันผลิต ──
  ingredient_name    VARCHAR(120) NOT NULL,
  unit               VARCHAR(20)  NOT NULL,

  -- หน่วยสต็อก (แปลงแล้วด้วย fn_recipe_qty_in_purchase_unit)
  planned_qty        NUMERIC(14,4) NOT NULL CHECK (planned_qty >= 0),
  actual_qty         NUMERIC(14,4) NOT NULL CHECK (actual_qty >= 0),

  -- ต้นทุนต่อหน่วยสต็อก ณ ตอนผลิต (มาจาก ingredients.avg_cost)
  unit_cost_snapshot NUMERIC(12,4) NOT NULL CHECK (unit_cost_snapshot >= 0),
  total_cost         NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0),

  sort_order         INTEGER NOT NULL DEFAULT 0,

  -- ต้นทุนบรรทัดต้องมาจากปริมาณจริง × ราคาจริง เสมอ (เผื่อปัดเศษ 1 สตางค์)
  CONSTRAINT production_batch_items_cost_check CHECK (
    ABS(total_cost - actual_qty * unit_cost_snapshot) <= 0.01
  ),
  UNIQUE (batch_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_production_batch_items_batch
  ON production_batch_items (batch_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_production_batch_items_ingredient
  ON production_batch_items (ingredient_id);


-- ═══ 4 · การเคลื่อนไหวสต็อกจากการผลิต ═════════════════════════════
--
-- reuse ingredient_stock_movements เดิม ไม่สร้างตารางใหม่
--
-- ตรวจแล้วว่าปลอดภัย: มีโค้ดอ่านค่า movement_type แค่ 2 จุด
--   1) restoreIngredientsForVoidedBill  WHERE movement_type='sale'
--      → ใบผลิตไม่มี bill_id จึงไม่มีทางถูกดึงมา ไม่กระทบ
--   2) getShoppingList                  WHERE movement_type='sale'
--      → กระทบ! Mayo ที่ถูกใช้ผลิตจะไม่ถูกนับเป็นการใช้
--        ต้องแก้เป็น IN ('sale','production_input') พร้อมกับ S1
--        ไม่งั้นระบบจะไม่เตือนให้ซื้อ Mayo แล้วของหมดกลางร้าน
--
-- production_output ห้ามนับเป็นการใช้ (มันคือของเข้า ไม่ใช่ของออก)

DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'ingredient_stock_movements'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%sale%'
    AND pg_get_constraintdef(oid) LIKE '%void_return%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ingredient_stock_movements DROP CONSTRAINT %I', con);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingredient_stock_movements_movement_type_check'
  ) THEN
    ALTER TABLE ingredient_stock_movements
      ADD CONSTRAINT ingredient_stock_movements_movement_type_check
      CHECK (movement_type IN (
        'sale', 'restock', 'adjustment', 'void_return',
        'production_input',   -- วัตถุดิบถูกใช้ไปกับการผลิต (qty ติดลบ)
        'production_output'   -- ผลผลิตเข้าสต็อก (qty เป็นบวก)
      ));
  END IF;
END $$;

ALTER TABLE ingredient_stock_movements
  ADD COLUMN IF NOT EXISTS production_batch_id UUID
    REFERENCES production_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredient_stock_movements_batch
  ON ingredient_stock_movements (production_batch_id)
  WHERE production_batch_id IS NOT NULL;

COMMIT;


-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน
-- ══════════════════════════════════════════════════════════════════
--
-- 1) ตารางใหม่ครบ 4 ตาราง
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE 'production_%' ORDER BY 1;
--
-- 2) วัตถุดิบเดิมทั้งหมดเป็น purchased (ต้องไม่มี produced ตอนนี้)
--
-- SELECT kind, COUNT(*) FROM ingredients GROUP BY kind;
--
-- 3) movement type รับ 6 ค่าแล้ว
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'ingredient_stock_movements_movement_type_check';
--
-- 4) การเคลื่อนไหวเดิมไม่ถูกแตะ
--
-- SELECT movement_type, COUNT(*) FROM ingredient_stock_movements GROUP BY 1;
--
-- ══════════════════════════════════════════════════════════════════
-- ยังไม่ได้ทำใน migration นี้ (เป็นงานของ S1 ฝั่ง application)
-- ══════════════════════════════════════════════════════════════════
--
-- · แก้ getShoppingList() ให้นับ production_input เป็นการใช้     ← บังคับ
-- · applyReceiveLine() เพิ่ม option เลือก movement type และไม่ตั้ง
--   last_purchase_price สำหรับผลผลิต (ซอสไม่ได้ถูกซื้อ)
-- · engine ผลิต: ล็อกใบ → ล็อกวัตถุดิบ → ตรวจสต็อกพอ → snapshot ต้นทุน
--   → หักวัตถุดิบ → movement → คิดต้นทุน → เพิ่มผลผลิต → weighted average
--   → movement → ปิดใบ ทั้งหมดใน transaction เดียว
-- · ห้าม complete ถ้าวัตถุดิบไม่พอ (การผลิตเป็นการตัดสินใจ ต้องรู้ก่อนลงมือ)
-- · endpoint ทั้งหมดหลัง requirePosSessionAndPlan + requireManagerUnlock
--
-- ⚠️ เรื่องที่ยังไม่ตัดสิน — รอเจ้าของตัดสินก่อน implement
--   "รับของเข้า" ของวัตถุดิบ kind='produced' ควรถูกห้ามไหม
--   ไม่ได้ใส่ไว้ใน migration เพราะการบล็อกที่ระดับ DB จะทำให้ผู้ใช้เห็น
--   ข้อความ constraint ดิบ ๆ แทนคำอธิบายที่อ่านรู้เรื่อง และ receivePurchase
--   เป็น engine ที่โหมดไปตลาดใช้ร่วมกัน — ควรบล็อกที่ชั้น application
--   พร้อม error code ที่แปลเป็นภาษาคนได้ มากกว่าบังคับที่ schema
-- ══════════════════════════════════════════════════════════════════
