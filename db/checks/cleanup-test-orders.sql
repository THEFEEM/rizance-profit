-- cleanup-test-orders — ลบออเดอร์จากสคริปต์ e2e ที่ปนอยู่ใน prod (29 ก.ค. 69)
--
-- ⚠️ อัปเดตวิธีกรอง: ใช้ชื่อ 'E2E %' ไม่ใช่เบอร์โทร
--    เพราะสคริปต์ใส่เบอร์ปลอม (0812345678 / 0890000088 / 0890000099) ทำให้
--    ตัวกรอง "ไม่มีเบอร์ = ลบได้" กลับด้าน: ของ e2e มีเบอร์ ส่วนออเดอร์หน้าร้านจริงไม่มีเบอร์
--
-- ปลอดภัยเรื่องบัญชี: ทุกแถวที่ลบมี bill_id IS NULL → ยังไม่ลงรายได้/journal/สต็อก


-- ═══ 1 · ดูรายการที่จะลบ (ต้องเป็น E2E ทั้งหมด) ═══
WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
SELECT o.order_no, o.status, o.customer_name, o.customer_phone, o.total_amount,
       (o.created_at AT TIME ZONE 'Asia/Bangkok') AS เวลาไทย
FROM pos_orders o
WHERE o.user_id = (SELECT id FROM u)
  AND o.bill_id IS NULL
  AND o.customer_name LIKE 'E2E %'
ORDER BY o.created_at DESC;


-- ═══ 2 · ตรวจว่าไม่มีออเดอร์จริงหลุดเข้าไปในเงื่อนไข ═══
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
-- SELECT
--   COUNT(*) FILTER (WHERE customer_name LIKE 'E2E %')     AS จะลบ_e2e,
--   COUNT(*) FILTER (WHERE customer_name NOT LIKE 'E2E %') AS เก็บไว้_ของจริง
-- FROM pos_orders WHERE user_id = (SELECT id FROM u) AND bill_id IS NULL;


-- ═══ 3 · ลบจริง — ปลดคอมเมนต์เมื่อรีวิวข้อ 1 แล้ว ═══
-- CASCADE ตามไป: pos_order_items → item_modifiers, pos_order_messages,
--                pos_order_feedback, pos_order_push_subs
--
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
-- DELETE FROM pos_orders o
-- WHERE o.user_id = (SELECT id FROM u)
--   AND o.bill_id IS NULL
--   AND o.customer_name LIKE 'E2E %'
-- RETURNING o.order_no, o.customer_name, o.total_amount;


-- ═══ 4 · ⚠️ พบปัญหาอีกอย่าง: บิลถูกสร้างแต่ออเดอร์ไม่ถูกผูก ═══
-- Q260729-034 (178) / -035 (134) / -036 (109) status=completed แต่ bill_id IS NULL
-- และ 178+134+109 = 421 = ยอดขายวันนี้ (3 บิล) พอดี
-- → บิลถูกสร้างจริง แต่ pos_orders.bill_id ไม่ได้ถูกเซ็ต
-- ผลเสีย: ประวัติโยงกันไม่ได้ · เสี่ยงเก็บเงินซ้ำ · ปุ่มในหน้าออเดอร์แสดงผิด
--
-- รันเพื่อยืนยันและหาคู่ที่ควรผูกกัน:
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
-- SELECT o.order_no, o.status, o.total_amount AS ยอดออเดอร์,
--        b.bill_no, b.total_amount AS ยอดบิล, b.payment_method,
--        (b.created_at AT TIME ZONE 'Asia/Bangkok') AS เวลาบิล
-- FROM pos_orders o
-- LEFT JOIN pos_bills b
--        ON b.user_id = o.user_id
--       AND b.total_amount = o.total_amount
--       AND b.created_at BETWEEN o.created_at - interval '2 hours'
--                            AND o.created_at + interval '2 hours'
-- WHERE o.user_id = (SELECT id FROM u)
--   AND o.status = 'completed' AND o.bill_id IS NULL
-- ORDER BY o.created_at DESC;
--
-- ถ้าคู่ตรงกันชัดเจน (ยอดตรง + เวลาใกล้) ผูกกลับได้ด้วย UPDATE ทีละใบ:
-- UPDATE pos_orders SET bill_id = '<bill uuid>', updated_at = now()
-- WHERE order_no = 'Q260729-034'
--   AND user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND bill_id IS NULL;


-- ═══ 5 · ออเดอร์จริงที่ต้องจัดการเอง (อย่าลบด้วย SQL) ═══
-- Q260729-070 · cooking · หน้าร้าน · ฿49 · 21:11
--   → ค้างอยู่ในสถานะ "กำลังทำ" ให้เคลียร์ในแอป: เก็บเงินให้จบ หรือกดยกเลิก
--
-- ออเดอร์ยกเลิกของลูกค้าจริง (ฟีม / บอล / น้องชาด / นาอีมี / หน้าร้าน)
--   → เก็บไว้เป็นประวัติดีกว่า ไม่กระทบบัญชีเพราะไม่มีบิล


-- ═══ 6 · เช็ค invariant หลังลบ (ต้องได้ ตรงกัน = true ทุกแถว) ═══
-- SELECT b.bill_no, b.total_amount,
--        (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ผลรวมรายการ,
--        b.total_amount = (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ตรงกัน
-- FROM pos_bills b
-- WHERE b.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND b.entry_date >= current_date - 7
-- ORDER BY b.created_at DESC;
