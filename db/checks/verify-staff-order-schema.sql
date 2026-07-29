-- verify-staff-order-schema — ตรวจว่า prod มีทุกอย่างที่ createStaffOrder ต้องใช้
-- ใช้ตอน POST /api/pos/orders ตอบ 500 แล้วอยากรู้ว่า migration ไหนขาด
-- อ่านผล: ❌ = ขาด/ไม่ตรง → คือต้นเหตุ

WITH need(tbl, col) AS (VALUES
  -- pos_orders — ทั้ง INSERT และ RETURNING ORDER_RETURN
  ('pos_orders','id'),('pos_orders','user_id'),('pos_orders','order_no'),
  ('pos_orders','status'),('pos_orders','channel'),('pos_orders','customer_name'),
  ('pos_orders','customer_phone'),('pos_orders','note'),('pos_orders','pickup_at_text'),
  ('pos_orders','total_amount'),('pos_orders','bill_id'),('pos_orders','cancel_reason'),
  ('pos_orders','created_at'),('pos_orders','payment_intent'),('pos_orders','slip_url'),
  ('pos_orders','slip_uploaded_at'),('pos_orders','slip_verified_at'),
  ('pos_orders','slip_rejected_reason'),('pos_orders','order_type'),
  ('pos_orders','delivery_address'),('pos_orders','delivery_note'),
  ('pos_orders','delivery_lat'),('pos_orders','delivery_lng'),
  ('pos_orders','delivery_accuracy_m'),('pos_orders','delivery_fee'),
  ('pos_orders','rider_id'),('pos_orders','picked_up_at'),
  ('pos_orders','delivered_at'),('pos_orders','cash_settled_at'),
  -- pos_order_items
  ('pos_order_items','order_id'),('pos_order_items','product_id'),
  ('pos_order_items','product_name'),('pos_order_items','unit_sell_price'),
  ('pos_order_items','quantity'),('pos_order_items','line_total'),
  ('pos_order_items','sort_order'),('pos_order_items','note'),
  -- อื่นๆ ที่เส้นทางนี้แตะ
  ('pos_order_item_modifiers','order_item_id'),('pos_order_item_modifiers','modifier_id'),
  ('pos_order_counters','user_id'),('pos_order_counters','counter_date'),
  ('pos_order_counters','last_seq')
)
SELECT '1 · คอลัมน์' AS หมวด,
       n.tbl || '.' || n.col AS รายการ,
       CASE WHEN c.column_name IS NULL THEN '❌ ขาด' ELSE 'ok' END AS ผล
FROM need n
LEFT JOIN information_schema.columns c
  ON c.table_name = n.tbl AND c.column_name = n.col AND c.table_schema = 'public'
WHERE c.column_name IS NULL   -- โชว์เฉพาะที่ขาด

UNION ALL
-- 2 · ตารางที่โค้ดใหม่อ้าง (แชท/คนส่ง/push) — ขาดแล้วจะพังจุดอื่น
SELECT '2 · ตาราง', t,
       CASE WHEN to_regclass(t) IS NULL THEN '❌ ขาด' ELSE 'ok' END
FROM (VALUES ('pos_riders'),('pos_order_messages'),
             ('pos_rider_push_subs'),('pos_staff_push_subs'),
             ('pos_order_push_subs'),('pos_order_feedback')) AS x(t)
WHERE to_regclass(t) IS NULL

UNION ALL
-- 3 · CHECK constraint ต้องยอมรับค่าที่ createStaffOrder ใส่ (status=accepted, channel=pos)
SELECT '3 · CHECK', conname,
       CASE
         WHEN conname = 'pos_orders_status_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%accepted%' THEN '❌ ไม่รับ accepted'
         WHEN conname LIKE '%channel%'
              AND pg_get_constraintdef(oid) NOT LIKE '%pos%' THEN '❌ ไม่รับ pos'
         ELSE 'ok · ' || pg_get_constraintdef(oid)
       END
FROM pg_constraint
WHERE conrelid = 'pos_orders'::regclass AND contype = 'c'

UNION ALL
-- 4 · ถ้าไม่มีแถว ❌ เลย = สคีมาครบ ปัญหาอยู่ที่อื่น
SELECT '4 · สรุป', 'ถ้าเห็นแต่แถว ok = สคีมาครบ → ดู Vercel Logs', 'อ่านหมายเหตุ'
ORDER BY 1, 2;
