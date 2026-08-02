-- cleanup-voided-e2e-bills — ลบบิลจาก e2e ที่ปนใน prod (1 ส.ค. 2569)
--
-- ยืนยันแล้วก่อนลบ:
--   • ทั้ง 15 ใบ void_reason เป็น "phase1 * e2e cleanup" / "phase1-flow void test"
--     → ไม่มีธุรกรรมลูกค้าจริงปน
--   • entry_ที่ผูก = 0 → ไม่มี income_entries เหลือ (สคริปต์ลบไปตอน cleanup แล้ว)
--     ยอดขายจริง 1 ส.ค. = ฿1,408 จาก 19 บิล paid ไม่ถูกกระทบ
--
-- ⚠️ อย่าใช้ไฟล์นี้กับบิลที่ลูกค้ายกเลิกจริง — บิลพวกนั้นคือ audit trail ที่พิสูจน์ว่าเงินไม่เข้า
--
-- ตารางที่เกี่ยวข้องกับ pos_bills:
--   CASCADE  → pos_bill_items (+ pos_bill_item_modifiers) · pos_bill_payments
--   SET NULL → pos_stock_movements · ingredient_stock_movements · pos_orders.bill_id
--   ไม่มี FK → journal_entries (ผูกด้วย source_event_id) ต้องลบเอง ไม่งั้นเหลือเศษ


-- ═══ 1 · ดูของที่จะถูกลบทั้งหมด (รันก่อนเสมอ) ═══
WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'),
tgt AS (
  SELECT id, bill_no FROM pos_bills
  WHERE user_id = (SELECT id FROM u)
    AND entry_date = '2026-08-01'
    AND status = 'voided'
    AND (void_reason LIKE 'phase1%' OR void_reason LIKE '%e2e%')
)
SELECT
  (SELECT COUNT(*) FROM tgt)                                                AS "บิลที่จะลบ (ควรเป็น 15)",
  (SELECT COUNT(*) FROM pos_bill_items   WHERE bill_id IN (SELECT id FROM tgt)) AS รายการในบิล,
  (SELECT COUNT(*) FROM pos_bill_payments WHERE bill_id IN (SELECT id FROM tgt)) AS การชำระเงิน,
  (SELECT COUNT(*) FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM tgt)) AS "stock movement (จะเป็น NULL)",
  (SELECT COUNT(*) FROM pos_orders WHERE bill_id IN (SELECT id FROM tgt))    AS "ออเดอร์ที่ผูก (จะเป็น NULL)",
  (SELECT COUNT(*) FROM journal_entries
     WHERE source_module = 'pos' AND source_event_id IN (SELECT id FROM tgt)) AS "journal ที่ต้องลบเอง",
  (SELECT COUNT(*) FROM income_entries e
     JOIN pos_bill_payments p ON p.income_entry_id = e.id
     WHERE p.bill_id IN (SELECT id FROM tgt))                               AS "income entry เหลือ (ควรเป็น 0)";


-- ═══ 2 · ลบจริง — ปลดคอมเมนต์ทั้งบล็อกเมื่อรีวิวข้อ 1 แล้ว ═══
-- ทำในทรานแซกชันเดียว ผิดพลาดตรงไหน rollback ทั้งหมด
--
-- BEGIN;
--
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'),
-- tgt AS (
--   SELECT id FROM pos_bills
--   WHERE user_id = (SELECT id FROM u)
--     AND entry_date = '2026-08-01'
--     AND status = 'voided'
--     AND (void_reason LIKE 'phase1%' OR void_reason LIKE '%e2e%')
-- ),
-- -- 2.1 ลบ stock movement ของบิลนี้ทิ้ง (ไม่ปล่อยให้เป็น NULL ลอย — เป็นของเทสไม่ใช่ของจริง)
-- del_stock AS (
--   DELETE FROM pos_stock_movements WHERE bill_id IN (SELECT id FROM tgt) RETURNING 1
-- ),
-- del_ing AS (
--   DELETE FROM ingredient_stock_movements WHERE bill_id IN (SELECT id FROM tgt) RETURNING 1
-- ),
-- -- 2.2 journal (lines จะ CASCADE ตาม) — ทั้ง pos_bill_paid และ pos_bill_voided
-- --     ต้องเคลียร์ reversed_by_entry_id ก่อน ไม่งั้น FK self-reference ขวาง
-- clr AS (
--   UPDATE journal_entries SET reversed_by_entry_id = NULL
--   WHERE source_module = 'pos' AND source_event_id IN (SELECT id FROM tgt)
--   RETURNING 1
-- ),
-- del_journal AS (
--   DELETE FROM journal_entries
--   WHERE source_module = 'pos' AND source_event_id IN (SELECT id FROM tgt)
--   RETURNING 1
-- )
-- -- 2.3 ลบบิล — items / item_modifiers / payments CASCADE ตามเอง
-- DELETE FROM pos_bills WHERE id IN (SELECT id FROM tgt)
-- RETURNING bill_no, total_amount, void_reason;
--
-- -- ตรวจก่อน COMMIT: ยอดขาย 1 ส.ค. ต้องยังเป็น 1408.00 จาก 19 บิล
-- SELECT COUNT(*) AS บิล, SUM(total_amount) AS ยอด
-- FROM pos_bills
-- WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND entry_date = '2026-08-01' AND status = 'paid';
--
-- -- ถูกต้อง → COMMIT;   ผิด → ROLLBACK;


-- ═══ 3 · ตรวจหลังลบ ═══
-- 3.1 ไม่มี journal กำพร้าที่ชี้ไปบิลที่ไม่มีอยู่แล้ว
-- SELECT COUNT(*) AS "journal กำพร้า (ต้องเป็น 0)"
-- FROM journal_entries j
-- WHERE j.source_module = 'pos'
--   AND j.source_event_type IN ('pos_bill_paid', 'pos_bill_voided')
--   AND NOT EXISTS (SELECT 1 FROM pos_bills b WHERE b.id = j.source_event_id);
--
-- 3.2 invariant ของบิลที่เหลือยังครบ
-- SELECT b.bill_no, b.total_amount,
--        (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ผลรวมรายการ,
--        b.total_amount = (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ตรงกัน
-- FROM pos_bills b
-- WHERE b.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND b.entry_date = '2026-08-01'
-- ORDER BY b.bill_no;
--
-- 3.3 journal ที่เหลือยัง debit = credit ทุกใบ
-- SELECT j.id, j.description,
--        SUM(l.debit) AS debit, SUM(l.credit) AS credit,
--        SUM(l.debit) = SUM(l.credit) AS ตรงกัน
-- FROM journal_entries j JOIN journal_lines l ON l.entry_id = j.id
-- WHERE j.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND j.entry_date = '2026-08-01'
-- GROUP BY j.id, j.description
-- HAVING SUM(l.debit) <> SUM(l.credit);   -- ต้องได้ 0 แถว
