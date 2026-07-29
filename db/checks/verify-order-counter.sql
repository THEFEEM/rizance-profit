-- verify-order-counter — เช็คว่า "เลขออเดอร์ชนกัน" ทำให้ createStaffOrder ตอบ 500 หรือไม่
--
-- nextOrderNo() สร้างเลขจาก pos_order_counters.last_seq + 1
-- ถ้า counter ต่ำกว่าเลขที่มีอยู่จริง → INSERT ชน UNIQUE (user_id, order_no) → PG 23505 → 500
--
-- ⚠️ วันที่ใช้ Asia/Bangkok (โค้ดใช้ today() = โซนไทย ไม่ใช่ CURRENT_DATE ของ DB ที่เป็น UTC)

WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'),
d AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS วันไทย),
pfx AS (SELECT 'Q' || to_char((SELECT วันไทย FROM d), 'YYMMDD') AS p),
mx AS (
  SELECT COALESCE(MAX(split_part(order_no, '-', 2)::int), 0) AS สูงสุดที่ใช้แล้ว,
         COUNT(*) AS จำนวนออเดอร์
  FROM pos_orders
  WHERE user_id = (SELECT id FROM u)
    AND order_no LIKE (SELECT p FROM pfx) || '-%'
),
ctr AS (
  SELECT COALESCE(last_seq, -1) AS counter
  FROM pos_order_counters
  WHERE user_id = (SELECT id FROM u) AND counter_date = (SELECT วันไทย FROM d)
)
SELECT
  (SELECT วันไทย FROM d)                              AS "วันที่ (ไทย)",
  (SELECT p FROM pfx)                                 AS "prefix เลขออเดอร์",
  COALESCE((SELECT counter FROM ctr), -1)             AS "counter ในระบบ",
  (SELECT สูงสุดที่ใช้แล้ว FROM mx)                    AS "เลขสูงสุดที่ใช้ไปแล้ว",
  (SELECT จำนวนออเดอร์ FROM mx)                        AS "จำนวนออเดอร์วันนี้",
  CASE
    WHEN (SELECT counter FROM ctr) IS NULL
      THEN '⚠️ ไม่มีแถว counter ของวันนี้ (ปกติ ระบบสร้างเองตอนสั่ง)'
    WHEN (SELECT counter FROM ctr) < (SELECT สูงสุดที่ใช้แล้ว FROM mx)
      THEN '❌ counter ต่ำกว่าเลขที่ใช้แล้ว → เลขชนกัน = ต้นเหตุ 500'
    ELSE 'ok · counter ไม่ชน (ปัญหาอยู่ที่อื่น)'
  END AS ผลวินิจฉัย;

-- ── ถ้าผลเป็น ❌ ให้รันบรรทัดนี้เพื่อซ่อม (ดันcounter ให้สูงกว่าเลขที่ใช้แล้ว) ──
-- UPDATE pos_order_counters c
-- SET last_seq = GREATEST(c.last_seq, (
--       SELECT COALESCE(MAX(split_part(o.order_no, '-', 2)::int), 0)
--       FROM pos_orders o
--       WHERE o.user_id = c.user_id
--         AND o.order_no LIKE 'Q' || to_char(c.counter_date, 'YYMMDD') || '-%'
--     ))
-- WHERE c.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com');
