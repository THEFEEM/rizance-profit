-- ══════════════════════════════════════════════════════════════════
-- AUDIT STEP 3 — บิลที่ต้นทุนต่อหน่วยสูงกว่าราคาขายต่อหน่วย
--
-- อ่านอย่างเดียว ไม่แก้อะไร รันซ้ำได้ ปลอดภัย 100%
-- รันทีละส่วนใน Supabase SQL Editor
--
-- ═══ ทำไมต้องดู ═══════════════════════════════════════════════════
-- closeBill คัดลอก pos_products.cost_price → pos_bill_items.unit_cost_price
-- ทุกบิล ถ้า cost_price เคยผิด บิลที่ขายไปแล้วจะเก็บต้นทุนผิดติดไว้ถาวร
-- และรายงานกำไรย้อนหลังจะเพี้ยนตาม
--
-- ⚠️ ห้าม bulk UPDATE บิลย้อนหลังจากผลของไฟล์นี้
--    บิลคือประวัติทางการเงิน ต้อง classify ก่อนเสมอ
--
-- นับเฉพาะ status = 'paid' (บิลที่ยกเลิกไม่นับเป็นยอดขายตามนิยามเดิม)
-- ══════════════════════════════════════════════════════════════════


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3A — สรุปหัวตาราง (ดูอันนี้ก่อน)
-- คาดหวัง: rows = 0
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT COUNT(*)                            AS "จำนวนบรรทัด",
       COUNT(DISTINCT bi.bill_id)          AS "จำนวนบิล",
       COUNT(DISTINCT bi.product_id)       AS "จำนวนเมนู",
       MIN(b.entry_date)                   AS "วันแรก",
       MAX(b.entry_date)                   AS "วันล่าสุด",
       ROUND(SUM(bi.line_cost - bi.line_total), 2) AS "ต้นทุนเกินยอดขายรวม"
FROM pos_bill_items bi
JOIN pos_bills b ON b.id = bi.bill_id
WHERE b.status = 'paid'
  AND bi.unit_cost_price > bi.unit_sell_price;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3B — รายบรรทัด (ถ้า 3A ได้ 0 ข้ามส่วนนี้ไปได้เลย)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT u.shop_name         AS "ร้าน",
       b.entry_date        AS "วันที่",
       b.bill_no           AS "เลขบิล",
       bi.product_name     AS "เมนู",
       bi.quantity         AS "จำนวน",
       bi.unit_sell_price  AS "ราคาขาย/หน่วย",
       bi.unit_cost_price  AS "ต้นทุน/หน่วย",
       ROUND(bi.unit_cost_price - bi.unit_sell_price, 2) AS "ต้นทุนเกิน/หน่วย",
       CASE WHEN bi.unit_sell_price > 0
            THEN ROUND(bi.unit_cost_price / bi.unit_sell_price, 1)
            ELSE NULL END  AS "เกินกี่เท่า",
       bi.line_total       AS "ยอดบรรทัด",
       bi.line_cost        AS "ต้นทุนบรรทัด",
       bi.discount_source  AS "ที่มาส่วนลด"
FROM pos_bill_items bi
JOIN pos_bills b ON b.id = bi.bill_id
JOIN users u ON u.id = b.user_id
WHERE b.status = 'paid'
  AND bi.unit_cost_price > bi.unit_sell_price
ORDER BY (bi.unit_cost_price - bi.unit_sell_price) DESC
LIMIT 200;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3C — จัดกลุ่มตามเมนู + เดาสาเหตุเบื้องต้น
--
-- ตัวช่วยแยกแยะ A (ขายต่ำกว่าทุนจริง) ออกจาก B (ต้นทุนผิด)
--   · เกินกี่เท่า ≈ 1000  → เกือบแน่ว่าเป็นบั๊กหน่วย
--   · เกินเล็กน้อย + มีส่วนลด → น่าจะเป็นการตัดสินใจทางราคา
--   · ต้นทุนปัจจุบันต่างจากบนบิลมาก → cost เคยเปลี่ยนหลังขาย
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT u.shop_name                      AS "ร้าน",
       bi.product_name                  AS "เมนู",
       COUNT(*)                         AS "บรรทัด",
       MIN(b.entry_date)                AS "วันแรก",
       MAX(b.entry_date)                AS "วันล่าสุด",
       ROUND(AVG(bi.unit_sell_price), 2) AS "ราคาขายเฉลี่ย",
       ROUND(AVG(bi.unit_cost_price), 2) AS "ต้นทุนบนบิลเฉลี่ย",
       p.cost_price                     AS "ต้นทุนปัจจุบัน",
       ROUND(AVG(
         CASE WHEN bi.unit_sell_price > 0
              THEN bi.unit_cost_price / bi.unit_sell_price END
       ), 1)                            AS "เกินกี่เท่าเฉลี่ย",
       COUNT(*) FILTER (WHERE bi.discount_source IS NOT NULL) AS "บรรทัดที่มีส่วนลด"
FROM pos_bill_items bi
JOIN pos_bills b ON b.id = bi.bill_id
JOIN users u ON u.id = b.user_id
LEFT JOIN pos_products p ON p.id = bi.product_id
WHERE b.status = 'paid'
  AND bi.unit_cost_price > bi.unit_sell_price
GROUP BY u.shop_name, bi.product_name, p.cost_price
ORDER BY 3 DESC;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3D — ภาพรวมสุขภาพต้นทุนทุกบิล (ไม่ใช่แค่ที่ผิดปกติ)
-- ใช้ดูว่า food cost โดยรวมสมเหตุสมผลไหม
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT u.shop_name                        AS "ร้าน",
       COUNT(DISTINCT b.id)               AS "จำนวนบิล",
       SUM(bi.line_total)                 AS "ยอดขายรวม",
       SUM(bi.line_cost)                  AS "ต้นทุนรวม",
       CASE WHEN SUM(bi.line_total) > 0
            THEN ROUND(100.0 * SUM(bi.line_cost) / SUM(bi.line_total), 1)
            ELSE NULL END                 AS "food cost %",
       COUNT(*) FILTER (WHERE bi.unit_cost_price = 0) AS "บรรทัดที่ต้นทุน 0"
FROM pos_bill_items bi
JOIN pos_bills b ON b.id = bi.bill_id
JOIN users u ON u.id = b.user_id
WHERE b.status = 'paid'
GROUP BY u.shop_name;


-- ══════════════════════════════════════════════════════════════════
-- อ่านผลยังไง
--
--   3A = 0 แถว
--     → เรื่องต้นทุนผิดหน่วยปิดได้สนิท เดินหน้า 0088 → tests → 0089
--
--   3A > 0 แถว  →  ห้ามแก้ข้อมูล ให้ classify ก่อนด้วย 3B/3C
--
--     A) ขายต่ำกว่าทุนจริง (ยอมรับได้)
--        เกินไม่มาก · มี discount_source (campaign/combo/coupon/partner)
--        · เป็นเมนูโปรโมชัน → ไม่ต้องแก้อะไร เป็นการตัดสินใจทางธุรกิจ
--
--     B) ต้นทุนผิด (ต้องคุยกันก่อนแตะ)
--        เกิน ~1000 เท่า → บั๊กหน่วย
--        ต้นทุนบนบิลต่างจากต้นทุนปัจจุบันมาก → cost เปลี่ยนหลังขาย
--        ต้นทุน > ราคาขายหลายเท่าโดยไม่มีส่วนลด → น่าสงสัย
--
--   3D ใช้ประกอบ: food cost ปกติของร้านอาหารอยู่ราว 30–40%
--     ถ้าเกิน 100% แปลว่ามีบางอย่างผิดแน่นอน
-- ══════════════════════════════════════════════════════════════════
