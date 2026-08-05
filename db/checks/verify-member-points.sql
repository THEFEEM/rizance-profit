-- ตรวจความถูกต้องระบบสมาชิก/แต้ม (หลังรัน 0068)
-- รันได้ทุกเมื่อ — ทุกข้อต้องได้ ✅ ทั้งหมด

-- ── 1) โครงสร้างครบไหม ─────────────────────────────────────────
SELECT 'tables' AS check_name,
       COUNT(*) FILTER (WHERE table_name = 'pos_members')      AS members,
       COUNT(*) FILTER (WHERE table_name = 'pos_point_events') AS point_events,
       CASE WHEN COUNT(*) = 2 THEN '✅' ELSE '❌' END AS ok
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('pos_members', 'pos_point_events');

SELECT 'new_columns' AS check_name, table_name, column_name, data_type, column_default,
       '✅' AS ok
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'pos_bills'          AND column_name = 'member_id') OR
    (table_name = 'pos_orders'         AND column_name = 'member_id') OR
    (table_name = 'pos_shop_settings'  AND column_name IN ('points_enabled','baht_per_point','reward_note'))
  )
ORDER BY table_name, column_name;

-- ── 2) ⭐ ยอดแคช points ต้องตรงกับ ledger เสมอ ──────────────────
-- ต้องได้ 0 แถว ถ้ามีแถวออกมา = แต้มเพี้ยน ต้องหาสาเหตุก่อนใช้งานต่อ
SELECT m.id, m.phone, m.points AS cached, COALESCE(SUM(e.delta), 0)::int AS ledger,
       '❌ แต้มไม่ตรง ledger' AS problem
FROM pos_members m
LEFT JOIN pos_point_events e ON e.member_id = m.id
GROUP BY m.id, m.phone, m.points
HAVING m.points <> COALESCE(SUM(e.delta), 0);

-- ── 3) ⭐ แต้มต้องไม่แตะบัญชี ───────────────────────────────────
-- ไม่ควรมี journal_entries / income_entries ที่อ้าง member หรือ point event
-- ต้องได้ 0 ทั้งคู่
SELECT 'points_touch_journal' AS check_name,
       (SELECT COUNT(*) FROM journal_entries
        WHERE source_event_type ILIKE '%point%' OR source_event_type ILIKE '%member%') AS journal_rows,
       (SELECT COUNT(*) FROM income_entries
        WHERE note ILIKE '%แต้ม%' OR note ILIKE '%point%') AS income_rows,
       CASE WHEN (SELECT COUNT(*) FROM journal_entries
                  WHERE source_event_type ILIKE '%point%' OR source_event_type ILIKE '%member%') = 0
             AND (SELECT COUNT(*) FROM income_entries
                  WHERE note ILIKE '%แต้ม%' OR note ILIKE '%point%') = 0
            THEN '✅ แต้มไม่ใช่เงิน — ถูกต้อง'
            ELSE '❌ มีรายการบัญชีที่อ้างแต้ม' END AS ok;

-- ── 4) ⭐ invariant บัญชีเดิมยังจริงอยู่ ────────────────────────
-- Σ line_total = total_amount ของทุกบิล paid — ต้องได้ 0 แถว
SELECT b.bill_no, b.total_amount, SUM(bi.line_total) AS items_total, '❌ ยอดไม่ตรง' AS problem
FROM pos_bills b
JOIN pos_bill_items bi ON bi.bill_id = b.id
WHERE b.status = 'paid'
GROUP BY b.id, b.bill_no, b.total_amount
HAVING b.total_amount <> SUM(bi.line_total);

-- ── 5) บิลยกเลิกต้องไม่มีแต้มค้าง ───────────────────────────────
-- ทุกบิล voided ที่เคยได้แต้ม ต้องมี void_reverse คู่กัน — ต้องได้ 0 แถว
SELECT b.bill_no, b.status,
       SUM(CASE WHEN e.reason = 'earn' THEN e.delta ELSE 0 END) AS earned,
       SUM(CASE WHEN e.reason = 'void_reverse' THEN e.delta ELSE 0 END) AS reversed,
       '❌ ยกเลิกแล้วแต่แต้มยังอยู่' AS problem
FROM pos_bills b
JOIN pos_point_events e ON e.bill_id = b.id
WHERE b.status = 'voided'
GROUP BY b.id, b.bill_no, b.status
HAVING SUM(e.delta) <> 0;

-- ── 6) สรุปภาพรวม ──────────────────────────────────────────────
SELECT COUNT(*) AS members,
       COALESCE(SUM(points), 0) AS points_outstanding,
       COALESCE(SUM(total_spent), 0) AS lifetime_spend,
       COALESCE(MAX(visit_count), 0) AS most_visits
FROM pos_members;

SELECT reason, COUNT(*) AS events, SUM(delta) AS net_points
FROM pos_point_events
GROUP BY reason
ORDER BY reason;
