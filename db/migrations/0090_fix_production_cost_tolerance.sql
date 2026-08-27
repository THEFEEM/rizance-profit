-- ══════════════════════════════════════════════════════════════════
-- 0090 — แก้ tolerance ของ invariant ต้นทุนใบผลิตใน 0089
--
-- ⚠️ แก้ของที่ผมเขียนผิดเองใน 0089 ไม่ใช่ฟีเจอร์ใหม่
--    0089 รันไปแล้วจึงแก้ย้อนหลังในไฟล์นั้นไม่ได้ ต้องเป็น migration ใหม่
--
-- ═══ ปัญหา ═══════════════════════════════════════════════════════
-- 0089 เขียน CHECK ไว้ว่า:
--     ABS(unit_cost * actual_output_qty - total_cost) <= 0.01
--
-- แต่ unit_cost เป็น NUMERIC(12,4) = เก็บได้ 4 ตำแหน่งเท่านั้น
-- และมันเป็นค่า "ที่คำนวณมา" (total_cost ÷ actual_output_qty)
-- การปัดลงเหลือ 4 ตำแหน่งทำให้คูณกลับไม่ได้เท่าเดิม
--
--     total_cost = ฿91.00 · ผลผลิต 1,500g
--     91 / 1500          = 0.060666...
--     เก็บได้จริง        = 0.0607
--     คูณกลับ 0.0607 × 1500 = ฿91.05   ← ต่างจาก ฿91.00 อยู่ ฿0.05
--
-- 0.05 > 0.01 → CHECK ปฏิเสธ ทั้งที่ตัวเลขถูกต้องทุกตัว
-- ยิ่งผลผลิตมาก ยิ่งต่างมาก (ผลผลิต 100,000 หน่วย ต่างได้ถึง ฿5)
--
-- ═══ ทางแก้ ═════════════════════════════════════════════════════
-- ให้ tolerance โตตามปริมาณผลผลิต ตามความคลาดเคลื่อนสูงสุดที่เกิดได้จริง:
--
--     ความคลาดสูงสุดต่อหน่วย = 0.00005  (ครึ่งหนึ่งของตำแหน่งที่ 4)
--     tolerance = 0.00005 × ผลผลิต + 0.01
--
-- ไม่ใช่การผ่อนกฎให้หลวม แต่เป็นการเขียนกฎให้ตรงกับความละเอียดที่มีอยู่จริง
-- ตัวเลขที่ผิดจริงยังถูกจับได้เหมือนเดิม เช่น unit_cost 0.999 กับผลผลิต 1,590
-- จะได้ ฿1,588 เทียบกับ total_cost ฿90 — ห่างกันหลายพันเท่า ยังถูกปฏิเสธ
--
-- หมายเหตุ: CHECK ของ production_batch_items ไม่ต้องแก้
--   เพราะ unit_cost_snapshot ไม่ใช่ค่าที่คำนวณมา มันคือ avg_cost ที่เก็บ
--   4 ตำแหน่งอยู่แล้วตรง ๆ การคูณจึงไม่สูญเสียความละเอียด
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE production_batches
  DROP CONSTRAINT IF EXISTS production_batches_cost_math_check;

ALTER TABLE production_batches
  ADD CONSTRAINT production_batches_cost_math_check CHECK (
    status <> 'completed'
    OR actual_output_qty IS NULL OR actual_output_qty = 0
    OR ABS(unit_cost * actual_output_qty - total_cost)
       <= 0.00005 * actual_output_qty + 0.01
  );

COMMIT;


-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน
--
-- 1) constraint ใหม่ขึ้นแล้ว
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'production_batches_cost_math_check';
--
-- 2) ใบผลิตเดิมทั้งหมดยังผ่าน CHECK (ต้องได้ 0 แถว)
--    หมายเหตุ: ณ วันที่รัน ยังไม่มีใบผลิตในระบบเลย
--
-- SELECT batch_no, unit_cost, actual_output_qty, total_cost
-- FROM production_batches
-- WHERE status = 'completed' AND actual_output_qty > 0
--   AND ABS(unit_cost * actual_output_qty - total_cost)
--       > 0.00005 * actual_output_qty + 0.01;
-- ══════════════════════════════════════════════════════════════════
