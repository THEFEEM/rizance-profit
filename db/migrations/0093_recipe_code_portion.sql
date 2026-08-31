-- 0093_recipe_code_portion — รหัสสูตร + ปริมาณใช้ต่อเมนู (planning)
--
-- ═══ ที่มา (31 ส.ค. 2569 — Dev อนุมัติ 3 decision) ══════════════════
-- Recipe Builder ใหม่ต้องการ 2 ฟิลด์ที่ schema เดิมไม่มี:
--
-- 1) recipe_code — รหัสสูตรที่คนอ่านออก (PRD-WRAP-SAUCE)
--    ⚠️ คนละอย่างกับ batch_prefix ที่มีอยู่แล้ว — ห้ามใช้ปนกัน:
--       recipe_code  = ตัวระบุ "สูตร"        เช่น PRD-WRAP-SAUCE
--       batch_prefix = คำนำหน้า "เลขใบผลิต"  เช่น WZS → WZS-20260831-001
--    ใบผลิตเก่าทั้งหมดอ้าง batch_prefix อยู่ จึงห้ามแตะ/เปลี่ยนความหมาย
--
-- 2) usage_per_portion — ใช้กี่หน่วยต่อ 1 เมนู (เช่น ซอส 20g/เมนู)
--    ⚠️ ใช้ "วางแผน/แสดงผล" เท่านั้น — ประมาณจำนวนเมนูต่อรอบ + ต้นทุนต่อเมนู
--    ห้ามใช้ตัดสต็อก · การตัดสต็อกตอนขายยังเป็นของ pos_product_ingredients
--    เพียงแหล่งเดียวเหมือนเดิม (กันเข้าใจผิดว่ามีสองแหล่ง)
--    หน่วยไม่เก็บซ้ำ — ใช้หน่วยเดียวกับผลผลิต (ingredients.purchase_unit
--    ของตัวซอส) ตามหลักเดียวกับที่ 0089 ไม่เก็บ output_unit ซ้ำ
--
-- ═══ additive ล้วน ═══════════════════════════════════════════════
-- · ทั้งสองคอลัมน์ nullable → สูตรเดิมทำงานต่อได้ทันทีโดยไม่ต้องแก้อะไร
-- · ไม่ backfill รหัสให้สูตรเก่า (ตั้งชื่อมั่วแล้วชนกันภายหลังแก้ยาก
--   ปล่อยให้เจ้าของตั้งเองผ่าน UI ซึ่ง auto-generate ให้อยู่แล้ว)
-- · ไม่แตะ production_batches / production_recipe_items / ข้อมูลใด ๆ
--
-- ═══ ย้อนกลับได้ไหม ═════════════════════════════════════════════
-- ได้ — ALTER TABLE production_recipes DROP COLUMN recipe_code, DROP COLUMN usage_per_portion;
-- (ไม่มีโค้ดเก่าพึ่งพาสองคอลัมน์นี้)

BEGIN;

ALTER TABLE production_recipes
  ADD COLUMN IF NOT EXISTS recipe_code VARCHAR(32);

ALTER TABLE production_recipes
  ADD COLUMN IF NOT EXISTS usage_per_portion NUMERIC(14,4);

-- ปริมาณต่อเมนูต้องเป็นบวกถ้ากรอกมา (NULL = ไม่ระบุ ปกติ)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_recipes_usage_per_portion_check'
  ) THEN
    ALTER TABLE production_recipes
      ADD CONSTRAINT production_recipes_usage_per_portion_check
      CHECK (usage_per_portion IS NULL OR usage_per_portion > 0);
  END IF;
END $$;

-- รหัสสูตรห้ามซ้ำ "ภายในร้านเดียวกัน" — scope เดียวกับ UNIQUE(user_id, name)
-- ที่ 0089 ใช้อยู่ · partial index เพราะ NULL ซ้ำกันได้ (สูตรเก่ายังไม่มีรหัส)
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_recipes_code
  ON production_recipes (user_id, recipe_code)
  WHERE recipe_code IS NOT NULL;

COMMENT ON COLUMN production_recipes.recipe_code IS
  'รหัสสูตรที่คนอ่านออก เช่น PRD-WRAP-SAUCE — คนละตัวกับ batch_prefix (คำนำหน้าเลขใบผลิต)';
COMMENT ON COLUMN production_recipes.usage_per_portion IS
  'ใช้กี่หน่วยต่อ 1 เมนู (หน่วยเดียวกับผลผลิต) — planning/display เท่านั้น ห้ามใช้ตัดสต็อก';

-- ── ตรวจตัวเองก่อน COMMIT ──────────────────────────────────────
DO $$
DECLARE
  n_cols INTEGER;
  n_idx  INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_cols FROM information_schema.columns
  WHERE table_name = 'production_recipes'
    AND column_name IN ('recipe_code', 'usage_per_portion');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION '0093: คอลัมน์ใหม่ไม่ครบ (เจอ %)', n_cols;
  END IF;

  SELECT COUNT(*) INTO n_idx FROM pg_indexes
  WHERE indexname = 'idx_production_recipes_code';
  IF n_idx <> 1 THEN
    RAISE EXCEPTION '0093: unique index รหัสสูตรไม่ถูกสร้าง';
  END IF;

  -- ⚠️ ห้ามเช็คว่า "recipe_code ต้องว่างทั้งหมด" — รันซ้ำหลังเจ้าของตั้งรหัสแล้ว
  --    จะล้มทันที ซึ่งขัดกฎ idempotent ของ repo นี้
  --    การไม่ backfill พิสูจน์จากตัว migration เองที่ไม่มีคำสั่ง UPDATE ใด ๆ
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน (บน Supabase)
-- ══════════════════════════════════════════════════════════════════
--
-- 1) คอลัมน์ใหม่ครบ + nullable
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'production_recipes'
--   AND column_name IN ('recipe_code', 'usage_per_portion', 'batch_prefix');
--
-- 2) สูตรเดิมยังอยู่ครบและใช้งานได้ (recipe_code ว่างทั้งหมด = ยังไม่ backfill)
--
-- SELECT name, batch_prefix, recipe_code, usage_per_portion,
--        expected_output_qty::text, is_active
-- FROM production_recipes ORDER BY name;
--
-- 3) รหัสซ้ำในร้านเดียวกันต้องถูกปฏิเสธ — คำสั่งนี้ต้อง "ล้มเหลว" ครั้งที่สอง
--
-- UPDATE production_recipes SET recipe_code = 'TEST-DUP' WHERE id = (
--   SELECT id FROM production_recipes ORDER BY created_at LIMIT 1);
-- UPDATE production_recipes SET recipe_code = 'TEST-DUP' WHERE id = (
--   SELECT id FROM production_recipes ORDER BY created_at DESC LIMIT 1);
-- -- อย่าลืมล้าง: UPDATE production_recipes SET recipe_code = NULL WHERE recipe_code = 'TEST-DUP';
