-- FK GUARD — ทุก FK ที่ชี้ users(id) ต้องลบบัญชีได้
-- อ่านอย่างเดียวทั้งไฟล์ (SELECT ล้วน) · รันบน production ได้ทุกเมื่อ
--
-- ═══ กติกาถาวรของโปรเจกต์ (ตั้งแต่ 0098 · 15 ก.ย. 2569) ═══════════════════
-- FK ทุกตัวที่ REFERENCES users(id) ต้องเป็น
--     ON DELETE CASCADE   (ลบตามเจ้าของ)
--   หรือ
--     ON DELETE SET NULL  (คง audit trail โดยตัดตัวตน — ปัจจุบันมี 2 จุดใน store_notes)
--
-- ถ้าเป็น NO ACTION / RESTRICT / SET DEFAULT → `DELETE FROM users` จะล้มเหลว
-- = ลบบัญชีตามสิทธิ PDPA และข้อกำหนด Google Play ไม่ได้
--
-- รันเมื่อ: หลัง deploy migration ใหม่ทุกครั้งที่เพิ่มตารางผูก user_id
-- PASS = Q1 คืน 0 แถว

-- ── Q1 · ตัวตัดสิน — PASS คือ "0 rows" ────────────────────────────────────
SELECT
  c.conrelid::regclass::text  AS table_name,
  c.conname                   AS constraint_name,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'  WHEN 'r' THEN 'RESTRICT'
    WHEN 'd' THEN 'SET DEFAULT'
  END                         AS violating_on_delete,
  pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
WHERE c.contype   = 'f'
  AND c.confrelid = 'users'::regclass
  AND c.confdeltype NOT IN ('c', 'n')
ORDER BY table_name, constraint_name;

-- ── Q2 · composite FK → users — ต้องรีวิวด้วยคนก่อนถือว่าปลอดภัย ─────────
--     ปัจจุบันคาดว่า 0 แถว (FK → users ทุกตัวเป็นคอลัมน์เดียว)
--     ถ้ามีแถวโผล่ = มีคนเพิ่ม composite FK → ต้องตรวจว่าลบบัญชียังทำงานถูกต้อง
SELECT
  c.conrelid::regclass::text  AS table_name,
  c.conname                   AS constraint_name,
  cardinality(c.conkey)       AS fk_column_count,
  pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
WHERE c.contype   = 'f'
  AND c.confrelid = 'users'::regclass
  AND cardinality(c.conkey) > 1
ORDER BY table_name, constraint_name;

-- ── Q3 · สรุปจำนวน (baseline หลัง 0098: CASCADE 94 · SET NULL 2 · รวม 96) ──
SELECT
  count(*) FILTER (WHERE confdeltype = 'c') AS cascade_count,
  count(*) FILTER (WHERE confdeltype = 'n') AS set_null_count,
  count(*) FILTER (WHERE confdeltype = 'a') AS no_action_count,
  count(*) FILTER (WHERE confdeltype = 'r') AS restrict_count,
  count(*) FILTER (WHERE confdeltype = 'd') AS set_default_count,
  count(*)                                  AS total_fk_to_users
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'users'::regclass;
