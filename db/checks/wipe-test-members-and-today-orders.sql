-- ล้างข้อมูลเทส: ออเดอร์วันนี้ (9 ส.ค.) + สมาชิก/แต้ม/เบอร์โทรทั้งหมด
-- 9 ส.ค. 2569 · รันทีละ STEP อ่านผลก่อนไปต่อ
--
-- ⚠️ ข้อบังคับก่อนรัน STEP 3:
--    บิลที่ "paid" ของวันนี้ต้อง "ยกเลิกในแอป" ก่อน (ประวัติบิล → ยกเลิก)
--    เพราะการยกเลิกในแอปคืนสต๊อก + ตัดรายรับ + กลับ journal + ถอนแต้ม ครบทุกอย่าง
--    การ DELETE บิล paid ตรง ๆ ด้วย SQL = ทำลาย invariant บัญชี ห้ามเด็ดขาด
--
-- สิ่งที่ SQL นี้ลบ: ออเดอร์ (ไม่ใช่บิล) + สมาชิก — สองอย่างนี้ไม่ใช่ข้อมูลบัญชี
--    pos_orders ลบ → order_items / messages CASCADE ตามสคีมา
--    pos_members ลบ → point_events / redeem_codes CASCADE · bills.member_id SET NULL (บิลไม่หาย)

-- ═══ STEP 1 · ดูก่อนว่าจะลบอะไร ═══════════════════════════════

-- 1a) สมาชิกทั้งหมด (ตอนนี้มีแต่เทส)
SELECT id, phone, name, points, total_spent, visit_count, created_at
FROM pos_members ORDER BY created_at;

-- 1b) ออเดอร์วันนี้
SELECT order_no, status, customer_name, customer_phone, total_amount, bill_id, created_at
FROM pos_orders
WHERE created_at >= '2026-08-09 00:00:00+07'
ORDER BY created_at;

-- 1c) ⚠️ บิล paid ของวันนี้ — ถ้ามีแถว ต้องไปยกเลิกในแอปให้หมดก่อน แล้วค่อยรัน STEP 3
SELECT bill_no, status, total_amount, payment_method, created_at
FROM pos_bills
WHERE created_at >= '2026-08-09 00:00:00+07' AND status = 'paid'
ORDER BY created_at;

-- ═══ STEP 2 · เช็คซ้ำหลังยกเลิกบิลในแอป (ต้องได้ 0) ═══════════

SELECT COUNT(*) AS paid_bills_today_must_be_zero
FROM pos_bills
WHERE created_at >= '2026-08-09 00:00:00+07' AND status = 'paid';

-- ═══ STEP 3 · ลบจริง (รันเมื่อ STEP 2 = 0 เท่านั้น) ═══════════

BEGIN;

-- ออเดอร์วันนี้ (order_items / messages หายตาม CASCADE)
DELETE FROM pos_orders
WHERE created_at >= '2026-08-09 00:00:00+07';

-- สมาชิกทั้งหมด: แต้ม + ประวัติแต้ม + โค้ดแลก + เบอร์โทร หายหมด
-- บิลเก่าที่เคยผูกสมาชิก → member_id เป็น NULL (ตัวบิล/บัญชีไม่ถูกแตะ)
DELETE FROM pos_members;

COMMIT;

-- ═══ STEP 4 · ตรวจหลังลบ ══════════════════════════════════════

SELECT
  (SELECT COUNT(*) FROM pos_members)                                        AS members,        -- 0
  (SELECT COUNT(*) FROM pos_point_events)                                   AS point_events,   -- 0
  (SELECT COUNT(*) FROM pos_redeem_codes)                                   AS redeem_codes,   -- 0
  (SELECT COUNT(*) FROM pos_orders
   WHERE created_at >= '2026-08-09 00:00:00+07')                            AS orders_today,   -- 0
  -- invariant บัญชีต้องยังจริง (0 แถวที่ผิด)
  (SELECT COUNT(*) FROM (
     SELECT b.id FROM pos_bills b JOIN pos_bill_items bi ON bi.bill_id = b.id
     WHERE b.status = 'paid' GROUP BY b.id, b.total_amount
     HAVING b.total_amount <> SUM(bi.line_total)) x)                        AS broken_bills;   -- 0
