-- verify-voided-bills-income — ตรวจว่าบิลที่ยกเลิกมีรายได้ค้างในงบจริงไหม
--
-- ⚠️ ทำไมต้องมีไฟล์นี้: query แบบ join แค่ pos_bills.income_entry_id ให้ผลผิด
--    เพราะบิลแยกจ่าย (split) เก็บ income_entry_id ไว้ที่ pos_bill_payments
--    ถ้า bills.income_entry_id เป็น NULL การ LEFT JOIN จะทำให้ voided_at IS NULL
--    แล้วนับเป็น "ค้างในงบ" ทั้งที่ยังไม่มี entry เลย
--
-- voidPosBill() ตัดรายได้จาก "ทุก" entry ที่ผูก (ทั้งทางตรงและผ่าน payments)
-- ไฟล์นี้จึงรวมทั้งสองทางแล้วเทียบ

WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'),
d AS (SELECT '2026-08-01'::date AS วันที่),
bl AS (
  SELECT b.id, b.bill_no, b.status, b.total_amount, b.income_entry_id
  FROM pos_bills b
  WHERE b.user_id = (SELECT id FROM u) AND b.entry_date = (SELECT วันที่ FROM d)
),
ent AS (
  -- entry ที่ผูกผ่าน payments (บิลแยกจ่าย + บิลปกติของโค้ดใหม่)
  SELECT bl.id AS bill_id, bl.bill_no, bl.status, e.id AS entry_id,
         e.voided_at, e.amount, e.payment_method
  FROM bl
  JOIN pos_bill_payments p ON p.bill_id = bl.id AND p.income_entry_id IS NOT NULL
  JOIN income_entries e ON e.id = p.income_entry_id
  UNION
  -- entry ที่ผูกทางตรง (บิลเก่า)
  SELECT bl.id, bl.bill_no, bl.status, e.id, e.voided_at, e.amount, e.payment_method
  FROM bl
  JOIN income_entries e ON e.id = bl.income_entry_id
)

-- ═══ 1 · สรุปตามสถานะบิล ═══
SELECT
  bl.status                                                        AS สถานะบิล,
  COUNT(DISTINCT bl.id)                                            AS จำนวนบิล,
  SUM(DISTINCT 0) + SUM(bl.total_amount)                           AS ยอดบิลรวม,
  COUNT(e.entry_id)                                                AS entry_ที่ผูก,
  COUNT(e.entry_id) FILTER (WHERE e.voided_at IS NOT NULL)         AS ตัดออกจากงบแล้ว,
  COUNT(e.entry_id) FILTER (WHERE e.voided_at IS NULL)             AS ยังนับอยู่ในงบ,
  COALESCE(SUM(e.amount) FILTER (WHERE e.voided_at IS NULL), 0)    AS ยอดที่ยังนับในงบ
FROM bl
LEFT JOIN ent e ON e.bill_id = bl.id
GROUP BY bl.status
ORDER BY bl.status;

-- อ่านผล:
--   paid   → ยังนับอยู่ในงบ = 19, ยอด = 1408.00   ✅ ถูกต้อง (บิลจริง)
--   voided → ยังนับอยู่ในงบ = 0,  ยอด = 0         ✅ ถูกต้อง (ตัดครบ)
--   ถ้า voided มี "ยอดที่ยังนับในงบ" > 0 → มีปัญหาจริง แจ้งกลับ


-- ═══ 2 · รายตัว ถ้าข้อ 1 พบว่ามีค้าง ═══
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
-- SELECT b.bill_no, b.status, b.total_amount,
--        b.income_entry_id IS NOT NULL       AS ผูกทางตรง,
--        (SELECT COUNT(*) FROM pos_bill_payments p
--          WHERE p.bill_id = b.id AND p.income_entry_id IS NOT NULL) AS ผูกผ่าน_payments,
--        (SELECT COUNT(*) FROM pos_bill_payments p
--          JOIN income_entries e ON e.id = p.income_entry_id
--          WHERE p.bill_id = b.id AND e.voided_at IS NULL)           AS entry_ที่ยังไม่ตัด
-- FROM pos_bills b
-- WHERE b.user_id = (SELECT id FROM u) AND b.entry_date = '2026-08-01'
-- ORDER BY b.bill_no;


-- ═══ 3 · เทียบกับยอดรายรับรวมของวันนั้นในงบ (ตัวเลขที่ผู้ใช้เห็นในแอปบัญชี) ═══
-- SELECT payment_method,
--        COUNT(*)                                        AS จำนวน,
--        SUM(amount) FILTER (WHERE voided_at IS NULL)    AS ยอดที่นับ,
--        SUM(amount) FILTER (WHERE voided_at IS NOT NULL) AS ยอดที่ถูกตัด
-- FROM income_entries
-- WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND entry_date = '2026-08-01'
-- GROUP BY payment_method;
-- ควรได้ cash + transfer รวม "ยอดที่นับ" = 1408.00 ตรงกับหน้าบิล
