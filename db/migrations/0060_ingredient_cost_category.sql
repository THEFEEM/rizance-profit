-- 0060_ingredient_cost_category — หมวดวัตถุดิบ + ต้นทุนเฉลี่ย + ราคาซื้อล่าสุด
--
-- รองรับ "โหมดไปตลาด": จัดลิสต์ตามหมวด (เดินตามโซนในห้าง) และโชว์ราคาครั้งก่อน
-- ให้กรอกเฉพาะตอนราคาเปลี่ยน
--
-- ต้นทุน 2 ตัวใช้คนละงาน:
--   last_purchase_price = ราคาต่อ 1 หน่วยซื้อ ครั้งล่าสุด → ใช้ตั้งราคาขาย/ต่อรอง
--   avg_cost            = ต้นทุนเฉลี่ยถ่วงน้ำหนัก → ใช้คิดกำไรจริง
--                         (ของในสต๊อกมาจากหลายรอบ หลายราคา)
--   สูตร: avg_new = (คงเหลือ × avg_เดิม + รับเข้า × ราคาต่อหน่วยครั้งนี้)
--                   ÷ (คงเหลือ + รับเข้า)
--
-- ⚠️ ไม่มีผลต่อบัญชี: เป็นข้อมูลต้นทุนเชิงบริหาร ไม่แตะ
--    SUM(bill_items.line_total) = total_amount = journal debit = credit
--    (การรับของยังลง expense_entries ตามยอดที่จ่ายจริงเหมือนเดิม)

BEGIN;

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category           VARCHAR(40);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS avg_cost           NUMERIC(12,4);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC(12,2);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS last_purchased_at  TIMESTAMPTZ;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS supplier_name      VARCHAR(120);

-- เริ่มต้น: ใช้ราคาที่กรอกไว้เป็นทั้งราคาล่าสุดและค่าเฉลี่ย
UPDATE ingredients
SET avg_cost = ROUND(purchase_price / NULLIF(purchase_quantity, 0), 4)
WHERE avg_cost IS NULL AND purchase_quantity > 0;

UPDATE ingredients
SET last_purchase_price = ROUND(purchase_price / NULLIF(purchase_quantity, 0), 2)
WHERE last_purchase_price IS NULL AND purchase_quantity > 0;

CREATE INDEX IF NOT EXISTS idx_ingredients_user_category
  ON ingredients (user_id, category);

COMMIT;
