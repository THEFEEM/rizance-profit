-- ตรวจระบบแลกแต้มด้วย QR (หลังรัน 0070)
-- ทุกข้อต้องได้ 0 แถว ยกเว้นข้อ 5 ที่เป็นรายงาน

-- ── 1) โครงสร้างครบ ────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='pos_redeem_codes') AS tbl_1,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='pos_shop_settings'
     AND column_name='redeem_points') AS col_1,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE tablename='pos_redeem_codes' AND indexname='idx_pos_redeem_codes_user_code') AS uniq_1;
-- ต้องได้ 1, 1, 1

-- ── 2) ⭐ แต้มแคชต้องตรง ledger เสมอ (รวม redeem จาก QR แล้ว) ───
SELECT m.id, m.phone, m.points AS cached, COALESCE(SUM(e.delta),0)::int AS ledger,
       '❌ แต้มไม่ตรง ledger' AS problem
FROM pos_members m
LEFT JOIN pos_point_events e ON e.member_id = m.id
GROUP BY m.id, m.phone, m.points
HAVING m.points <> COALESCE(SUM(e.delta), 0);

-- ── 3) ⭐ โค้ดที่ถูกใช้ ต้องมี point_event 'redeem' คู่กัน 1 ใบ ──
-- ตัดแต้มไปแล้วแต่ไม่มีร่องรอย = ผิด / มีร่องรอยแต่โค้ดยังไม่ถูกเผา = ผิด
SELECT c.code, c.points, c.used_at,
       (SELECT COUNT(*) FROM pos_point_events e
        WHERE e.member_id = c.member_id AND e.reason='redeem'
          AND e.created_at BETWEEN c.used_at - interval '5 seconds'
                              AND c.used_at + interval '5 seconds') AS matching_events,
       '❌ โค้ดถูกใช้แต่ไม่พบ event ตัดแต้ม' AS problem
FROM pos_redeem_codes c
WHERE c.used_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pos_point_events e
    WHERE e.member_id = c.member_id AND e.reason = 'redeem'
      AND e.created_at BETWEEN c.used_at - interval '5 seconds'
                          AND c.used_at + interval '5 seconds'
  );

-- ── 4) ⭐ แลกแต้มต้องไม่แตะบัญชี ────────────────────────────────
-- ไม่มีบิล/รายรับ/journal ที่ถูกสร้างจากการแลกแต้ม — ต้องได้ 0 ทั้งแถว
SELECT
  (SELECT COUNT(*) FROM income_entries
   WHERE note ILIKE '%แลกแต้ม%' OR note ILIKE '%redeem%') AS income_rows,
  (SELECT COUNT(*) FROM journal_entries
   WHERE source_event_type ILIKE '%redeem%' OR source_event_type ILIKE '%point%') AS journal_rows;
-- ต้องได้ 0, 0

-- ── 4b) ⭐ invariant บัญชีเดิมยังจริง ──────────────────────────
SELECT b.bill_no, b.total_amount, SUM(bi.line_total) AS items_total, '❌ ยอดไม่ตรง' AS problem
FROM pos_bills b
JOIN pos_bill_items bi ON bi.bill_id = b.id
WHERE b.status = 'paid'
GROUP BY b.id, b.bill_no, b.total_amount
HAVING b.total_amount <> SUM(bi.line_total);

-- ── 5) รายงาน: สถานะโค้ดทั้งหมด ────────────────────────────────
SELECT
  COUNT(*) AS total_codes,
  COUNT(*) FILTER (WHERE used_at IS NOT NULL) AS used,
  COUNT(*) FILTER (WHERE used_at IS NULL AND expires_at > now()) AS active,
  COUNT(*) FILTER (WHERE used_at IS NULL AND expires_at <= now()) AS expired_unused,
  COALESCE(SUM(points) FILTER (WHERE used_at IS NOT NULL), 0) AS points_redeemed
FROM pos_redeem_codes;

-- ── 6) รายงาน: โค้ดที่ยังใช้ได้ตอนนี้ (ควรมีน้อยมาก) ───────────
SELECT c.code, m.phone, c.points, c.expires_at
FROM pos_redeem_codes c JOIN pos_members m ON m.id = c.member_id
WHERE c.used_at IS NULL AND c.expires_at > now()
ORDER BY c.expires_at;
