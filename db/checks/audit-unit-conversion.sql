-- ══════════════════════════════════════════════════════════════════
-- AUDIT 13.2 — ต้นทุนเมนูผิดหน่วยหรือเปล่า
--
-- อ่านอย่างเดียว ไม่แก้อะไร รันซ้ำได้ ปลอดภัย 100%
-- รันทีละ STEP ใน Supabase SQL Editor (ไฮไลต์เฉพาะ STEP นั้นแล้วกด Run)
--
-- ═══ เรื่องย่อ ═══════════════════════════════════════════════════
-- โค้ด TypeScript แปลงหน่วยก่อนคูณ (kg → หาร 1000)
-- แต่ trigger fn_recalc_product_cost ใน 0076 ไม่แปลง
--
--   TS  : recipeQuantityInPurchaseUnits(60,'kg') × 250 = 0.06 × 250 = ฿15
--   DB  : 60 × 250                                                  = ฿15,000
--
-- พิสูจน์บน PGlite แล้วว่าต่างกัน 1,000 เท่าเป๊ะ สำหรับ kg และ l
-- ส่วน g · ml · piece · shot · pump ตรงกันดี ไม่มีปัญหา
--
-- ไฟล์นี้ตอบคำถามเดียว: "ข้อมูลจริงของเราโดนไหม"
-- ══════════════════════════════════════════════════════════════════


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1 — วัตถุดิบที่ใช้หน่วยต้องแปลง (kg / l)
-- คาดหวัง 0 แถว · มีแถว = เสี่ยง แต่ยังไม่แน่ว่ากระทบเมนู (ดู STEP 2)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT u.shop_name       AS "ร้าน",
       i.name            AS "วัตถุดิบ",
       i.purchase_unit   AS "หน่วย",
       i.avg_cost        AS "ต้นทุนต่อหน่วย",
       i.stock_qty       AS "คงเหลือ"
FROM ingredients i
JOIN users u ON u.id = i.user_id
WHERE i.purchase_unit IN ('kg', 'l')
ORDER BY u.shop_name, i.name;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2 — เมนูที่ต้นทุนผิดจริง  ← นี่คือคำตอบหลัก
-- คาดหวัง 0 แถว · มีแถว = cost_price ของเมนูพวกนี้ผิดอยู่ตอนนี้
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WITH conv AS (
  SELECT pi.product_id,
         SUM(
           CASE i.purchase_unit
             WHEN 'kg' THEN pi.quantity / 1000.0
             WHEN 'l'  THEN pi.quantity / 1000.0
             ELSE pi.quantity
           END * COALESCE(i.avg_cost, 0)
         ) AS correct_total,
         COUNT(*) FILTER (WHERE i.purchase_unit IN ('kg','l')) AS bad_lines
  FROM pos_product_ingredients pi
  JOIN ingredients i ON i.id = pi.ingredient_id
  GROUP BY pi.product_id
)
SELECT u.shop_name                              AS "ร้าน",
       p.name                                   AS "เมนู",
       p.sell_price                             AS "ราคาขาย",
       p.cost_price                             AS "ต้นทุนที่ระบบเก็บไว้",
       ROUND(c.correct_total, 2)                AS "ต้นทุนที่ถูกต้อง",
       ROUND(p.cost_price - c.correct_total, 2) AS "เกินไป",
       c.bad_lines                              AS "บรรทัดที่ผิดหน่วย"
FROM conv c
JOIN pos_products p ON p.id = c.product_id
JOIN users u ON u.id = p.user_id
WHERE c.bad_lines > 0
ORDER BY (p.cost_price - c.correct_total) DESC;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3 — บิลเก่าที่ snapshot ต้นทุนผิดไปแล้ว
-- closeBill คัดลอก pos_products.cost_price ลง pos_bill_items.unit_cost_price
-- ถ้า cost_price ผิด บิลที่ขายไปแล้วก็เก็บค่าผิดไว้ → รายงานกำไรเพี้ยน
-- เกณฑ์: ต้นทุนต่อหน่วย > ราคาขายต่อหน่วย = ผิดปกติเกือบแน่นอน
-- คาดหวัง 0 แถว
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT u.shop_name        AS "ร้าน",
       b.entry_date       AS "วันที่",
       COUNT(*)           AS "จำนวนบรรทัด",
       SUM(bi.line_cost)  AS "ต้นทุนรวมที่บันทึกไว้",
       SUM(bi.line_total) AS "ยอดขายรวม"
FROM pos_bill_items bi
JOIN pos_bills b ON b.id = bi.bill_id
JOIN users u ON u.id = b.user_id
WHERE b.status = 'paid'
  AND bi.unit_cost_price > bi.unit_sell_price
GROUP BY u.shop_name, b.entry_date
ORDER BY b.entry_date DESC
LIMIT 50;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 4 — หน่วยที่ใช้อยู่จริงทั้งหมด (ภาพรวม)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT i.purchase_unit AS "หน่วย",
       COUNT(*)        AS "จำนวนวัตถุดิบ",
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM pos_product_ingredients pi
                       WHERE pi.ingredient_id = i.id)
       )               AS "ผูกสูตรแล้ว",
       CASE WHEN i.purchase_unit IN ('kg','l')
            THEN 'ต้องแปลง' ELSE 'ปลอดภัย' END AS "สถานะ"
FROM ingredients i
GROUP BY i.purchase_unit
ORDER BY 2 DESC;


-- ══════════════════════════════════════════════════════════════════
-- อ่านผลยังไง
--
--   STEP 2 = 0 แถว
--     → ข้อมูลจริงไม่โดน ไม่ต้อง hotfix ข้อมูล
--     → แต่ยังต้องแก้ trigger ที่ต้นเหตุอยู่ดี ไม่งั้นวันไหนมีคนเพิ่ม
--       วัตถุดิบหน่วย kg เข้ามา ต้นทุนจะผิดเงียบ ๆ ทันที
--
--   STEP 2 มีแถว
--     → ต้นทุนเมนูพวกนั้นผิดอยู่ตอนนี้
--     → hotfix trigger + recalc cost_price ใหม่ทุกเมนู · commit แยกจาก Production
--
--   STEP 3 มีแถว
--     → บิลที่ขายไปแล้วเก็บต้นทุนผิด รายงานกำไรย้อนหลังเพี้ยน
--     → ต้องตัดสินใจว่าจะแก้ย้อนหลังหรือปล่อยแล้วติดหมายเหตุ
--       (บิลเป็น historical snapshot การแก้ย้อนหลังมีทั้งข้อดีข้อเสีย)
-- ══════════════════════════════════════════════════════════════════
