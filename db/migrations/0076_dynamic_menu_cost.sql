-- 0076_dynamic_menu_cost — ต้นทุนเมนูคำนวณจากสูตรอัตโนมัติ + ประวัติราคา
--
-- หลักการ: pos_products.cost_price ของเมนูที่ "ผูกสูตรแล้ว" ห้ามเป็นค่ากรอกมือ
-- อีกต่อไป — DB คำนวณให้เอง = Σ(ปริมาณในสูตร × avg_cost วัตถุดิบ)
--
-- ทำไมทำที่ DB (trigger) ไม่ใช่ที่ TS:
--   ราคาวัตถุดิบเปลี่ยนได้ 4 ทาง — แก้ในหน้าสต็อก / โหมดไปตลาด (weighted avg)
--   / รับเข้าเดี่ยว / สคริปต์ SQL — ถ้า sync ที่ TS ต้องจำให้ครบทุกทาง
--   พลาดทางเดียวต้นทุนค้าง trigger คุมที่ตารางเดียวครอบทุกทางถาวร
--
-- ผลที่ตามมาโดยไม่ต้องแก้โค้ดขาย: closeBill snapshot cost_price ลง
-- pos_bill_items.unit_cost_price อยู่แล้วทุกบิล → บิลเก่าเก็บต้นทุน ณ วันขาย
-- (audit ได้) บิลใหม่ได้ต้นทุนล่าสุดเอง · รายงานกำไรเดิมถูกอัตโนมัติ
--
-- ⚠️ ไม่มีผลต่อบัญชี: cost_price เป็นข้อมูลบริหาร ไม่แตะ
--    SUM(bill_items.line_total) = total_amount = journal debit = credit
--
-- เมนูที่ "ไม่มีสูตร" (เช่นน้ำดื่ม) cost_price ยังกรอกมือได้เหมือนเดิม

BEGIN;

-- ═══ 1 · ประวัติราคาวัตถุดิบ (append-only — รายงานย้อนหลังตรวจได้) ═══

CREATE TABLE IF NOT EXISTS ingredient_price_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id       UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  avg_cost            NUMERIC(12,4),
  last_purchase_price NUMERIC(12,2),
  purchase_quantity   NUMERIC(12,4),
  purchase_price      NUMERIC(12,2),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_price_history_ingredient
  ON ingredient_price_history (ingredient_id, recorded_at DESC);

-- ═══ 2 · แก้ราคาซื้อ = ต้นทุนปัจจุบันใหม่ ═══════════════════════
-- หน้าสต็อกแก้ purchase_price/quantity โดยไม่ได้ตั้ง avg_cost มาด้วย
-- → derive ให้: avg_cost = ราคา ÷ ปริมาณ (โหมดไปตลาด/รับเข้า ตั้ง avg_cost
-- มาเองใน UPDATE เดียวกัน (weighted) → เงื่อนไข IS NOT DISTINCT ปล่อยผ่าน)

CREATE OR REPLACE FUNCTION fn_ingredient_derive_cost() RETURNS trigger AS $$
BEGIN
  IF (NEW.purchase_price    IS DISTINCT FROM OLD.purchase_price OR
      NEW.purchase_quantity IS DISTINCT FROM OLD.purchase_quantity)
     AND NEW.avg_cost IS NOT DISTINCT FROM OLD.avg_cost
     AND COALESCE(NEW.purchase_quantity, 0) > 0 THEN
    NEW.avg_cost            := ROUND(NEW.purchase_price / NEW.purchase_quantity, 4);
    NEW.last_purchase_price := ROUND(NEW.purchase_price / NEW.purchase_quantity, 2);
    NEW.last_purchased_at   := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ingredient_derive_cost ON ingredients;
CREATE TRIGGER trg_ingredient_derive_cost
  BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_ingredient_derive_cost();

-- ═══ 3 · บันทึกประวัติทุกครั้งที่ต้นทุนเปลี่ยน ═══════════════════

CREATE OR REPLACE FUNCTION fn_ingredient_log_price() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.avg_cost            IS DISTINCT FROM OLD.avg_cost
     OR NEW.last_purchase_price IS DISTINCT FROM OLD.last_purchase_price THEN
    INSERT INTO ingredient_price_history
      (user_id, ingredient_id, avg_cost, last_purchase_price,
       purchase_quantity, purchase_price)
    VALUES
      (NEW.user_id, NEW.id, NEW.avg_cost, NEW.last_purchase_price,
       NEW.purchase_quantity, NEW.purchase_price);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ingredient_log_price ON ingredients;
CREATE TRIGGER trg_ingredient_log_price
  AFTER INSERT OR UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_ingredient_log_price();

-- ═══ 4 · คำนวณ cost_price ของเมนูจากสูตร ══════════════════════

CREATE OR REPLACE FUNCTION fn_recalc_product_cost(pids UUID[]) RETURNS void AS $$
  UPDATE pos_products p
  SET cost_price = sub.total, updated_at = now()
  FROM (
    SELECT pi.product_id,
           ROUND(SUM(pi.quantity * COALESCE(i.avg_cost, 0)), 2) AS total
    FROM pos_product_ingredients pi
    JOIN ingredients i ON i.id = pi.ingredient_id
    WHERE pi.product_id = ANY (pids)
    GROUP BY pi.product_id
  ) sub
  WHERE p.id = sub.product_id
    AND p.cost_price IS DISTINCT FROM sub.total;
$$ LANGUAGE sql;

-- 4a) ราคาวัตถุดิบเปลี่ยน → recalc ทุกเมนูที่ใช้ตัวนั้น
CREATE OR REPLACE FUNCTION fn_ingredient_cost_changed() RETURNS trigger AS $$
BEGIN
  IF NEW.avg_cost IS DISTINCT FROM OLD.avg_cost THEN
    PERFORM fn_recalc_product_cost(ARRAY(
      SELECT product_id FROM pos_product_ingredients WHERE ingredient_id = NEW.id));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ingredient_cost_changed ON ingredients;
CREATE TRIGGER trg_ingredient_cost_changed
  AFTER UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_ingredient_cost_changed();

-- 4b) สูตรเปลี่ยน (เพิ่ม/แก้/ลบบรรทัด) → recalc เมนูนั้น
--     กรณีลบสูตรออกหมด: คงค่า cost ล่าสุดไว้ (ไม่รีเซ็ตเป็น 0 เงียบ ๆ)
CREATE OR REPLACE FUNCTION fn_recipe_changed() RETURNS trigger AS $$
BEGIN
  PERFORM fn_recalc_product_cost(
    ARRAY[COALESCE(NEW.product_id, OLD.product_id)]);
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recipe_changed ON pos_product_ingredients;
CREATE TRIGGER trg_recipe_changed
  AFTER INSERT OR UPDATE OR DELETE ON pos_product_ingredients
  FOR EACH ROW EXECUTE FUNCTION fn_recipe_changed();

-- ═══ 5 · เป้า Food Cost ต่อร้าน (default 37%) ══════════════════

ALTER TABLE pos_shop_settings
  ADD COLUMN IF NOT EXISTS target_food_cost_pct NUMERIC(5,2) NOT NULL DEFAULT 37;

-- ═══ 6 · backfill — คำนวณเมนูที่ผูกสูตรแล้วทั้งหมดตอนนี้ ════════

SELECT fn_recalc_product_cost(ARRAY(
  SELECT DISTINCT product_id FROM pos_product_ingredients));

-- baseline วัตถุดิบปัจจุบัน → ประวัติแถวแรก (เฉพาะตัวที่มีราคาและยังไม่มีประวัติ)
INSERT INTO ingredient_price_history
  (user_id, ingredient_id, avg_cost, last_purchase_price,
   purchase_quantity, purchase_price)
SELECT user_id, id, avg_cost, last_purchase_price, purchase_quantity, purchase_price
FROM ingredients i
WHERE avg_cost IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ingredient_price_history h WHERE h.ingredient_id = i.id);

COMMIT;
