-- ตรวจ Feedback Center (0073) — รันหลัง migration และหลังเทสจริง
-- แต่ละ STEP อ่านผลก่อนไปต่อ · ทุก query เป็นการอ่านอย่างเดียว ยกเว้น STEP 4

-- ═══ STEP 1 · migration ลงครบไหม ══════════════════════════════

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'pos_feedback')                                    AS fb_cols,       -- 23
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'pos_feedback_items')                              AS item_cols,     -- 7
  (SELECT COUNT(*) FROM pg_indexes
   WHERE tablename = 'pos_feedback')                                     AS fb_indexes,    -- ≥ 5
  (SELECT feedback_enabled FROM pos_shop_settings LIMIT 1)               AS fb_enabled,    -- true
  (SELECT feedback_points  FROM pos_shop_settings LIMIT 1)               AS fb_points;     -- 20

-- index กันฟาร์มแต้มต้องมีชื่อนี้เป๊ะ — code จับ error ด้วยชื่อนี้
-- ถ้าเปลี่ยนชื่อ index การกันฟาร์มจะเงียบ ๆ กลายเป็น 500 แทน
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'pos_feedback' AND indexname IN
  ('idx_pos_feedback_award_once_per_day', 'idx_pos_feedback_quick_once');

-- reason 'feedback' ต้องอยู่ใน CHECK ของ ledger แต้ม
SELECT pg_get_constraintdef(oid) AS point_reason_check
FROM pg_constraint WHERE conname = 'pos_point_events_reason_check';
-- ต้องเห็น: ... 'earn','void_reverse','redeem','adjust','feedback' ...

-- ═══ STEP 2 · รีวิวเก่าย้ายครบไหม ═════════════════════════════
-- สองตัวต้องเท่ากัน ไม่งั้นมีรีวิวเก่าหล่นหาย

SELECT
  (SELECT COUNT(*) FROM pos_order_feedback)                              AS old_rows,
  (SELECT COUNT(*) FROM pos_feedback WHERE source = 'quick')             AS migrated;

-- ═══ STEP 3 · หลังเทส: แต้มโบนัสถูกต้องไหม ════════════════════

-- 3a) feedback ที่ได้แต้ม — ต้องมีสมาชิก และต้องมีบิลของสมาชิกนั้นในวันเดียวกัน
--     แถวที่ออกมา = ผิดกฎ (ต้องได้ 0 แถว)
SELECT f.id, f.business_date, f.points_awarded, f.member_id, m.phone
FROM pos_feedback f
LEFT JOIN pos_members m ON m.id = f.member_id
WHERE f.points_awarded > 0
  AND NOT EXISTS (
    SELECT 1 FROM pos_bills b
    WHERE b.user_id = f.user_id AND b.member_id = f.member_id
      AND b.status = 'paid' AND b.entry_date = f.business_date
  );

-- 3b) ให้แต้มเกิน 1 ครั้ง/สมาชิก/วันขาย — ต้องได้ 0 แถว (index บังคับอยู่)
SELECT member_id, business_date, COUNT(*) AS awarded_times
FROM pos_feedback
WHERE points_awarded > 0
GROUP BY member_id, business_date
HAVING COUNT(*) > 1;

-- 3c) แต้มใน ledger ต้องตรงกับ points_awarded ที่บันทึกไว้
--     ต้องได้ผลรวมเท่ากันทั้งสองคอลัมน์
SELECT
  (SELECT COALESCE(SUM(points_awarded), 0) FROM pos_feedback)            AS from_feedback,
  (SELECT COALESCE(SUM(delta), 0) FROM pos_point_events
   WHERE reason = 'feedback')                                            AS from_ledger;

-- 3d) แต้มคงเหลือของสมาชิกต้องเท่ากับผลรวม ledger ทุกคน — ต้องได้ 0 แถว
SELECT m.id, m.phone, m.points AS balance, COALESCE(SUM(pe.delta), 0) AS ledger
FROM pos_members m
LEFT JOIN pos_point_events pe ON pe.member_id = m.id
GROUP BY m.id, m.phone, m.points
HAVING m.points <> COALESCE(SUM(pe.delta), 0);

-- ═══ STEP 4 · invariant บัญชียังจริง (feedback ต้องไม่แตะเงิน) ══

SELECT
  -- บิลที่ Σ line_total ไม่ตรง total_amount — ต้อง 0
  (SELECT COUNT(*) FROM (
     SELECT b.id FROM pos_bills b JOIN pos_bill_items bi ON bi.bill_id = b.id
     WHERE b.status = 'paid' GROUP BY b.id, b.total_amount
     HAVING b.total_amount <> SUM(bi.line_total)) x)                     AS broken_bills,
  -- journal ที่เดบิต ≠ เครดิต — ต้อง 0
  (SELECT COUNT(*) FROM (
     SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
     GROUP BY je.id
     HAVING COALESCE(SUM(jl.debit), 0) <> COALESCE(SUM(jl.credit), 0)) y) AS unbalanced_journals,
  -- feedback ไม่ควรสร้าง journal ใด ๆ — ต้อง 0
  (SELECT COUNT(*) FROM journal_entries
   WHERE source_module = 'feedback')                                      AS feedback_journals;

-- ═══ STEP 5 · ภาพรวมที่ร้านจะเห็นบน dashboard ═════════════════

SELECT
  COUNT(*)                                                    AS total,
  COUNT(*) FILTER (WHERE status = 'new')                      AS unread,
  COUNT(*) FILTER (WHERE kind = 'issue' AND status <> 'resolved') AS open_issues,
  ROUND(AVG(rating_overall)::numeric, 2)                      AS avg_overall,
  ROUND(AVG(rating_taste)::numeric, 2)                        AS avg_taste,
  ROUND(AVG(rating_service)::numeric, 2)                      AS avg_service,
  ROUND(AVG(rating_clean)::numeric, 2)                        AS avg_clean
FROM pos_feedback;

-- เมนูคะแนนต่ำ (จุดที่แก้แล้วเห็นผลเร็วสุด)
SELECT i.product_name, ROUND(AVG(i.rating)::numeric, 2) AS avg, COUNT(*) AS votes
FROM pos_feedback_items i
GROUP BY i.product_name
ORDER BY avg ASC, votes DESC
LIMIT 10;

-- เมนูที่ลูกค้าขอ
SELECT comment, created_at FROM pos_feedback
WHERE kind = 'menu_idea' AND comment IS NOT NULL
ORDER BY created_at DESC LIMIT 20;
