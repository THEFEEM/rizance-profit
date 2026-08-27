-- ══════════════════════════════════════════════════════════════════
-- 0088 — แก้ trigger คิดต้นทุนเมนูให้แปลงหน่วยเหมือนฝั่ง TypeScript
--
-- ⚠️ นี่คือ HOTFIX ของบั๊กเดิม ไม่ใช่ฟีเจอร์ใหม่
--    ไม่เกี่ยวกับงาน Production/Sauce ซึ่งอยู่ใน 0089
--
-- ═══ ปัญหา ═══════════════════════════════════════════════════════
-- ระบบคิดต้นทุนเมนู 2 ทาง แล้วสองทางไม่ตรงกัน:
--
--   TypeScript (mapRecipeLine → recipeQuantityInPurchaseUnits)
--       kg, l  → หาร 1000
--       อื่น ๆ → คูณ 1
--
--   DB trigger (fn_recalc_product_cost ใน 0076)
--       ทุกหน่วย → คูณ 1        ← ไม่แปลงเลย
--
-- ผล: วัตถุดิบหน่วย kg/l ที่อยู่ในสูตร ทำให้ pos_products.cost_price
--     สูงเกินจริง 1,000 เท่า และค่าผิดนั้นถูก snapshot ลง
--     pos_bill_items.unit_cost_price ทุกบิลที่ขายหลังจากนั้น
--
-- พิสูจน์บน PGlite แล้ว: เนื้อ 1 กก. ฿250 สูตรใช้ 60 กรัม
--     TS ได้ ฿15.00   ·   DB ได้ ฿15,000.00
--
-- ═══ สถานะข้อมูลจริง ณ วันที่แก้ ═════════════════════════════════
-- ตรวจแล้ว (db/checks/audit-unit-conversion.sql):
--     kg → มี 4 ตัว · ผูกสูตร 0
--     l  → มี 4 ตัว · ผูกสูตร 0
-- → ไม่มีเมนูไหนได้รับผลกระทบ migration นี้จึงต้องเป็น no-op
-- → ถ้า cost_price ขยับแม้แต่บาทเดียว = มีบางอย่างที่เรายังไม่รู้
--   migration จะ ABORT ตัวเองทันที (ดูส่วนที่ 5)
--
-- ═══ ขอบเขต ═════════════════════════════════════════════════════
-- ✓ แปลง kg → g และ l → ml เท่านั้น (เท่าที่ระบบรองรับจริงวันนี้)
-- ✗ ไม่เดาค่าแปลงของหน่วยที่ยังไม่มี config เช่น ขีด / ปอนด์ / ออนซ์
--   หน่วยที่ไม่รู้จัก = factor 1 ตามพฤติกรรมเดิมเป๊ะ ๆ
--   (หน่วยไทยที่ใช้อยู่จริง: แผ่น ชิ้น ใบ ลูก คู่ → ผลลัพธ์ไม่เปลี่ยน)
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1 · เก็บค่าก่อนแก้ไว้เทียบ ═══════════════════════════════════
-- ตารางชั่วคราวแบบ TEMP ไม่ได้ เพราะต้องอ่านได้หลัง COMMIT
-- ตั้งชื่อขึ้นต้น _ ให้ชัดว่าเป็นของชั่วคราว ลบทิ้งได้หลังตรวจเสร็จ

DROP TABLE IF EXISTS _cost_before_0088;
CREATE TABLE _cost_before_0088 AS
SELECT id AS product_id, cost_price
FROM pos_products;


-- ═══ 2 · ตัวแปลงหน่วย — คู่แฝดของ recipeQuantityInPurchaseUnits() ═══
--
-- ⚠️ ถ้าแก้ฟังก์ชันนี้ ต้องแก้ lib/pricing-units.ts ให้ตรงกันเสมอ
--    มี test บังคับความตรงกันอยู่ (test-unit-parity.mjs)
--
-- สูตรกรอกเป็น "หน่วยใช้งาน" (กรัม/มล./ชิ้น)
-- แต่ avg_cost เป็นราคาต่อ "หน่วยซื้อ" → ต้องแปลงก่อนคูณ

CREATE OR REPLACE FUNCTION fn_recipe_qty_in_purchase_unit(
  qty  NUMERIC,
  unit TEXT
) RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN qty IS NULL OR qty <= 0 THEN 0
    WHEN unit = 'kg' THEN qty / 1000.0   -- สูตรกรอกเป็นกรัม ราคาเป็นต่อ กก.
    WHEN unit = 'l'  THEN qty / 1000.0   -- สูตรกรอกเป็น มล. ราคาเป็นต่อ ลิตร
    ELSE qty                             -- g · ml · piece · shot · pump
                                         -- และหน่วยกำหนดเอง (แผ่น ชิ้น ใบ ลูก คู่)
  END;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION fn_recipe_qty_in_purchase_unit(NUMERIC, TEXT) IS
  'แปลงปริมาณในสูตร (หน่วยใช้งาน) → หน่วยซื้อ ต้องตรงกับ recipeQuantityInPurchaseUnits() ใน lib/pricing-units.ts เสมอ';


-- ═══ 3 · แทนตัวคำนวณต้นทุนเมนู ═════════════════════════════════════
-- เปลี่ยนแค่บรรทัดเดียว: pi.quantity → fn_recipe_qty_in_purchase_unit(...)
-- โครงที่เหลือคงเดิมทุกตัวอักษรจาก 0076
-- trigger ที่เรียกฟังก์ชันนี้ (trg_ingredient_cost_changed · trg_recipe_changed)
-- ไม่ถูกแตะ ไม่ต้อง DROP/CREATE ใหม่

CREATE OR REPLACE FUNCTION fn_recalc_product_cost(pids UUID[]) RETURNS void AS $$
  UPDATE pos_products p
  SET cost_price = sub.total, updated_at = now()
  FROM (
    SELECT pi.product_id,
           ROUND(SUM(
             fn_recipe_qty_in_purchase_unit(pi.quantity, i.purchase_unit)
             * COALESCE(i.avg_cost, 0)
           ), 2) AS total
    FROM pos_product_ingredients pi
    JOIN ingredients i ON i.id = pi.ingredient_id
    WHERE pi.product_id = ANY (pids)
    GROUP BY pi.product_id
  ) sub
  WHERE p.id = sub.product_id
    AND p.cost_price IS DISTINCT FROM sub.total;
$$ LANGUAGE sql;


-- ═══ 4 · คำนวณเมนูที่ผูกสูตรใหม่ทั้งหมด ═══════════════════════════

SELECT fn_recalc_product_cost(ARRAY(
  SELECT DISTINCT product_id FROM pos_product_ingredients));


-- ═══ 5 · ตรวจว่าเป็น no-op จริง — ถ้าไม่ใช่ ยกเลิกทั้งหมด ══════════
--
-- audit บอกว่าไม่มีสูตรไหนใช้ kg/l → ต้นทุนต้องไม่ขยับสักบาท
-- ถ้าขยับ = มีเงื่อนไขที่ยังไม่เข้าใจ ต้องหยุดดูก่อน ไม่ใช่ปล่อยผ่าน
--
-- ⚠️ ถ้าวันหน้ามีสูตรใช้ kg/l จริงและตั้งใจให้ต้นทุนเปลี่ยน
--    ให้ลบบล็อกนี้ทิ้งอย่างตั้งใจ พร้อมบันทึกเหตุผล
--    ห้ามลบเพียงเพราะ migration รันไม่ผ่าน

DO $$
DECLARE
  changed INT;
  detail  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(
           format('%s: %s → %s', p.name, b.cost_price, p.cost_price), E'\n  ')
    INTO changed, detail
  FROM _cost_before_0088 b
  JOIN pos_products p ON p.id = b.product_id
  WHERE p.cost_price IS DISTINCT FROM b.cost_price;

  IF changed > 0 THEN
    RAISE EXCEPTION E'0088 ยกเลิกการทำงาน — ต้นทุนเมนูเปลี่ยน % รายการ ทั้งที่ควรเป็น no-op\n  %\nกรุณาตรวจ db/checks/audit-unit-conversion.sql อีกครั้งก่อน deploy',
      changed, detail;
  END IF;

  RAISE NOTICE '0088 OK — ต้นทุนเมนูไม่เปลี่ยนสักรายการ (ตรวจ % เมนู)',
    (SELECT COUNT(*) FROM _cost_before_0088);
END $$;

COMMIT;


-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน
-- ══════════════════════════════════════════════════════════════════
--
-- 1) ต้นทุนไม่ขยับ (ต้องได้ 0 แถว)
--
-- SELECT p.name, b.cost_price AS ก่อน, p.cost_price AS หลัง
-- FROM _cost_before_0088 b JOIN pos_products p ON p.id = b.product_id
-- WHERE p.cost_price IS DISTINCT FROM b.cost_price;
--
-- 2) ฟังก์ชันแปลงหน่วยทำงานถูก (kg/l ต้องหาร 1000 · ที่เหลือคูณ 1)
--
-- SELECT u AS หน่วย, fn_recipe_qty_in_purchase_unit(10, u) AS "แปลง 10 หน่วย"
-- FROM unnest(ARRAY['g','kg','ml','l','piece','shot','pump',
--                   'แผ่น','ชิ้น','ใบ','ลูก','คู่']) AS u;
--
--   คาดหวัง: kg = 0.01 · l = 0.01 · ที่เหลือ = 10 ทั้งหมด
--
-- 3) เก็บกวาดเมื่อพอใจแล้ว
--
-- DROP TABLE _cost_before_0088;
-- ══════════════════════════════════════════════════════════════════
