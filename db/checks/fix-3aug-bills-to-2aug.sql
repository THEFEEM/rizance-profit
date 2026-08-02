-- fix-3aug-bills-to-2aug — ย้ายยอดขายที่ตกวันผิดกลับไปวันที่ขายจริง
--
-- สถานการณ์ (3 ส.ค. 2569): รับออเดอร์ก่อนเที่ยงคืนวันที่ 2 แต่เก็บเงินไม่ทัน
-- บิลจึงถูกลงเป็นวันที่ 3 → ยอดวันที่ 2 ขาด · วันที่ 3 เกิน
--
-- ⚠️ ทำไมไม่สร้างบิลด้วย SQL: บิลต้องผ่าน closePosBill เพื่อให้ได้ income_entries +
--    journal (debit=credit) + ตัดสต็อก + bill_no ที่ถูกลำดับครบ การเขียนมือเสี่ยง
--    ทำ invariant พังแบบตรวจไม่เจอ → ใช้ UI กรอกแล้วค่อยเลื่อนวันที่ด้วย SQL
--
-- ลำดับที่ต้องทำ (ห้ามข้าม):
--   ขั้น A · ยกเลิกบิลผิด 3 ใบ "ในแอป" (แท็บบิล) — ระบบกลับรายได้/สต็อก/journal ให้ครบ
--   ขั้น B · กรอกยอดจริง 7 บิลผ่านหน้าขาย POS (เลือกเงินสด/โอนให้ตรง)
--   ขั้น C · รันไฟล์นี้ เลื่อน entry_date ของ 7 บิลใหม่ 3 ส.ค. → 2 ส.ค.
--   ขั้น D · ตรวจยอดทั้งสองวัน


-- ═══ ขั้น A ยืนยัน: บิลผิด 3 ใบถูกยกเลิกแล้ว ═══
WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
SELECT bill_no, status, total_amount, payment_method, void_reason
FROM pos_bills
WHERE user_id = (SELECT id FROM u) AND entry_date = '2026-08-03'
ORDER BY bill_no;
-- ต้องเห็น 3 ใบเดิม status = 'voided' ก่อนไปขั้น B
-- (ยกเลิกในแอปเท่านั้น — voidPosBill คืนสต็อก + ตัดรายได้ + กลับ journal ให้ครบ)


-- ═══ ขั้น C · เลื่อนวันที่ของบิลที่กรอกใหม่ (รันหลังกรอกครบ 7 ใบ) ═══
-- ทำในทรานแซกชันเดียว ตรวจแล้วค่อย COMMIT
--
-- BEGIN;
--
-- WITH u AS (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com'),
-- tgt AS (
--   -- เฉพาะบิลวันที่ 3 ที่ยัง paid = 7 ใบที่กรอกใหม่ (ของผิดถูก void ไปแล้วในขั้น A)
--   SELECT id FROM pos_bills
--   WHERE user_id = (SELECT id FROM u)
--     AND entry_date = '2026-08-03'
--     AND status = 'paid'
-- ),
-- -- C.1 รายได้ในงบ (ทั้งที่ผูกทางตรงและผ่าน payments)
-- ent AS (
--   SELECT DISTINCT e.id
--   FROM income_entries e
--   WHERE e.id IN (SELECT income_entry_id FROM pos_bills WHERE id IN (SELECT id FROM tgt))
--      OR e.id IN (SELECT income_entry_id FROM pos_bill_payments
--                  WHERE bill_id IN (SELECT id FROM tgt) AND income_entry_id IS NOT NULL)
-- ),
-- mv_ent AS (
--   UPDATE income_entries SET entry_date = '2026-08-02'
--   WHERE id IN (SELECT id FROM ent) RETURNING 1
-- ),
-- -- C.2 journal (ทั้ง pos_bill_paid และ pos_bill_voided ของบิลชุดนี้)
-- mv_journal AS (
--   UPDATE journal_entries SET entry_date = '2026-08-02'
--   WHERE source_module = 'pos' AND source_event_id IN (SELECT id FROM tgt)
--   RETURNING 1
-- )
-- -- C.3 ตัวบิล
-- UPDATE pos_bills SET entry_date = '2026-08-02'
-- WHERE id IN (SELECT id FROM tgt)
-- RETURNING bill_no, total_amount, payment_method;
--
-- -- ควรได้ 7 แถว · เงินสด 2 ใบ · โอน 5 ใบ
-- -- ถูกต้อง → COMMIT;   ผิด → ROLLBACK;


-- ═══ ขั้น D · ตรวจหลังเลื่อน ═══
-- D.1 ยอดขายทั้งสองวัน
-- SELECT entry_date, status, COUNT(*) AS บิล, SUM(total_amount) AS ยอด
-- FROM pos_bills
-- WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND entry_date IN ('2026-08-02', '2026-08-03')
-- GROUP BY entry_date, status ORDER BY entry_date, status;
-- คาดว่า: 2 ส.ค. paid = ยอดเดิม + ยอดใหม่ · 3 ส.ค. paid = 0 บิล เหลือแต่ voided 3 ใบ
--
-- D.2 รายได้ในงบต้องตรงกับบิล (แยกช่องทาง)
-- SELECT entry_date, payment_method,
--        SUM(amount) FILTER (WHERE voided_at IS NULL) AS ยอดที่นับ
-- FROM income_entries
-- WHERE user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND entry_date IN ('2026-08-02', '2026-08-03')
-- GROUP BY entry_date, payment_method ORDER BY entry_date, payment_method;
--
-- D.3 journal ต้อง debit = credit ทุกใบ และไม่มีใบไหนค้างวันที่ 3
-- SELECT j.entry_date, COUNT(*) AS ใบ,
--        SUM(l.debit) AS debit, SUM(l.credit) AS credit,
--        SUM(l.debit) = SUM(l.credit) AS ตรงกัน
-- FROM journal_entries j JOIN journal_lines l ON l.entry_id = j.id
-- WHERE j.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND j.entry_date IN ('2026-08-02', '2026-08-03')
-- GROUP BY j.entry_date ORDER BY j.entry_date;
--
-- D.4 invariant ของบิลที่ย้ายมา
-- SELECT b.bill_no, b.entry_date, b.total_amount,
--        (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ผลรวมรายการ,
--        b.total_amount = (SELECT SUM(i.line_total) FROM pos_bill_items i WHERE i.bill_id = b.id) AS ตรงกัน
-- FROM pos_bills b
-- WHERE b.user_id = (SELECT id FROM users WHERE email = 'ninenon2026@gmail.com')
--   AND b.entry_date = '2026-08-02'
-- ORDER BY b.bill_no;


-- ═══ หมายเหตุเรื่องเลขบิล ═══
-- เลขบิลจะยังเป็น 20260803-xxx แม้ entry_date เป็น 2 ส.ค.
-- ไม่ต้องแก้: รายงาน/งบทุกตัวใช้ entry_date · เลขบิลเป็นแค่เลขอ้างอิง
-- และการคงเลขเดิมไว้ทำให้ตรวจย้อนได้ว่าใบนี้ถูกออกตอน 00:xx ของวันที่ 3 จริง
-- (ถ้าเปลี่ยนเลขต้องไปยุ่งกับ pos_bill_counters ของวันที่ 2 ด้วย เสี่ยงเลขชนกันไม่คุ้ม)


-- ═══ ถ้าต้องการลบบิลผิด 3 ใบทิ้งด้วย (ทำหลังขั้น D ผ่านแล้ว) ═══
-- ใช้ db/checks/cleanup-voided-e2e-bills.sql แต่เปลี่ยนเงื่อนไขเป็น
--   entry_date = '2026-08-03' AND status = 'voided'
-- แนะนำ: เก็บไว้ก็ได้ เป็นหลักฐานว่าแก้อะไรไป (ยอด 0 ไม่กระทบงบ)
