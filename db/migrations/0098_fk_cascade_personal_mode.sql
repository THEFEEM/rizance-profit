-- 0098_fk_cascade_personal_mode — FK hardening: personal mode → ON DELETE CASCADE
--
-- ═══ สถานะ (15 ก.ย. 2569) ═════════════════════════════════════════════════
-- ⚠️ การเปลี่ยนแปลงนี้ **ถูก apply ลง production ไปแล้ว** ผ่าน Supabase SQL Editor
--    ไม่ได้ผ่าน `npm run db:migrate` → `schema_migrations` จึงยังไม่มีแถวของ 0098
--    (ตรวจแล้ว: SELECT … WHERE version LIKE '0098%' → 0 rows)
--    มี precedent เดิมในโปรเจกต์: 0066 ก็เคยถูก apply ด้วยมือ (ดู scripts/phase-o-readonly-check.mjs)
--
--    ไฟล์นี้จึงมีไว้เพื่อ 2 อย่าง:
--      1. ให้ repo สะท้อนสิ่งที่อยู่บน production จริง (source of truth ตรงกัน)
--      2. ให้ฐานข้อมูลใหม่/ฐานข้อมูลอื่น (local · CI · PGlite) ได้สคีมาเดียวกัน
--
--    เมื่อ runner เจอไฟล์นี้บน production ที่ apply ไปแล้ว → เข้า early-return
--    (noaction = 0) → **ไม่รัน DDL ใด ๆ** → runner บันทึก version ให้เอง
--    ห้าม INSERT schema_migrations ด้วยมือ
--
-- ⚠️ ชื่อไฟล์นี้เป็น identity ของ migration (runner ใช้ชื่อไฟล์เต็มรวม .sql)
--    **ห้ามเปลี่ยนชื่อไฟล์นี้อีก** ไม่งั้น runner จะถือว่าเป็น migration ใหม่และรันซ้ำ
--
-- ═══ ทำไมต้องมี ═══════════════════════════════════════════════════════════
-- FK ที่ชี้ users(id) ก่อนแก้: CASCADE 91 · SET NULL 2 · NO ACTION 3 · รวม 96
-- 3 จุดที่เป็น NO ACTION (ไม่ประกาศ ON DELETE ใน 0016 / schema.sql):
--     personal_income_entries.user_id
--     personal_expense_entries.user_id
--     savings_goals.user_id
-- → ทำให้ `DELETE FROM users WHERE id = $1` ล้มเหลวด้วย FK violation เสมอ
-- → ลบบัญชีตามข้อกำหนด Google Play / สิทธิ PDPA ไม่ได้
-- ทุก FK อื่นในระบบใส่ CASCADE ไว้หมด — 3 จุดนี้จึงถือเป็นการตกหล่น ไม่ใช่การออกแบบ
--
-- ═══ ผลหลังรัน (ยืนยันบน production แล้ว) ═════════════════════════════════
--     CASCADE 94 · SET NULL 2 · NO ACTION 0 · รวม 96 (จำนวนรวมไม่เปลี่ยน)
--
-- ═══ ขอบเขต ═══════════════════════════════════════════════════════════════
-- แก้เฉพาะพฤติกรรม ON DELETE ของ 3 FK นี้
-- ไม่แตะ: คอลัมน์ · ชนิดข้อมูล · NOT NULL · CHECK · PK · index · ข้อมูลในตาราง
-- ไม่แตะ: ON UPDATE (คง NO ACTION) · MATCH SIMPLE · ไม่ทำ DEFERRABLE
-- ไม่สร้างตารางใหม่ (account_deletion_requests / billing_archive = คนละงาน ยังไม่อนุมัติ)
--
-- ═══ ชื่อ constraint ══════════════════════════════════════════════════════
-- 0016/schema.sql ประกาศ FK แบบ inline ไม่ตั้งชื่อ → ชื่อถูกสร้างโดย PostgreSQL
-- ไฟล์นี้ **ไม่เดาชื่อ** แต่ค้นจาก pg_catalog ตอนรัน แล้วสร้างใหม่ด้วยชื่อเดิมเป๊ะ
--
-- ═══ fail-closed ══════════════════════════════════════════════════════════
-- ทุก assertion ใช้ RAISE EXCEPTION → ทั้งไฟล์อยู่ในทรานแซกชันเดียว ผิดนิดเดียว rollback หมด
--   early-return: noaction = 0 → NOTICE แล้ว RETURN ทันที ก่อนถึง assertion และก่อน DDL ทุกบรรทัด
--   ก่อนแก้: เซ็ตของ FK NO ACTION ต้อง "ตรงเป๊ะ" กับ 3 ตารางที่ระบุ (EXCEPT สองทาง + นับแถวดิบ)
--   ระหว่างแก้: ของเดิมต้องเป็น NO ACTION / ON UPDATE NO ACTION / MATCH SIMPLE / ไม่ DEFERRABLE
--   หลังแก้: NO ACTION = 0 · SET NULL เท่าเดิม · CASCADE = เดิม+3 · จำนวนรวมเท่าเดิม
--
-- Additive · idempotent · รันซ้ำได้ · ไม่ลบข้อมูล · ไม่ reset อะไร

BEGIN;

DO $$
DECLARE
  expected_tables CONSTANT text[] := ARRAY[
    'personal_income_entries',
    'personal_expense_entries',
    'savings_goals'
  ];

  cascade_before  integer;
  setnull_before  integer;
  noaction_before integer;
  total_before    integer;
  cascade_after   integer;
  setnull_after   integer;
  noaction_after  integer;
  total_after     integer;

  actual_count integer;
  extra_count  integer;   -- actual − expected
  missing_count integer;  -- expected − actual
  actual_list  text;
  t   text;
  fk  record;
  n   integer;
BEGIN
  -- ── 0) ถ่ายภาพสถานะก่อนแก้ ────────────────────────────────────────────
  SELECT
    count(*) FILTER (WHERE confdeltype = 'c'),
    count(*) FILTER (WHERE confdeltype = 'n'),
    count(*) FILTER (WHERE confdeltype = 'a'),
    count(*)
  INTO cascade_before, setnull_before, noaction_before, total_before
  FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'users'::regclass;

  RAISE NOTICE '0098 BEFORE: cascade=% setnull=% noaction=% total=%',
    cascade_before, setnull_before, noaction_before, total_before;

  IF noaction_before = 0 THEN
    RAISE NOTICE '0098: ไม่มี FK NO ACTION เหลืออยู่ — เคยรันไปแล้ว ข้ามทั้งไฟล์';
    RETURN;
  END IF;

  -- ── 1) fail-closed: SET EQUALITY ของ FK NO ACTION (ไม่ขึ้นกับลำดับ) ────
  --    · key = "ตาราง.คอลัมน์(ทั้งหมด)->ตารางแม่.คอลัมน์(ทั้งหมด)"
  --      composite FK จะได้ key แบบ a+b ทำให้ "ไม่ตรง" และถูกจับได้ ไม่ถูกยุบเงียบ ๆ
  --    · เทียบด้วย EXCEPT สองทาง + นับจำนวนแถวดิบ (ไม่ DISTINCT) → จับ duplicate ด้วย
  WITH actual AS (
    SELECT format(
             '%s.%s->%s.%s',
             c.conrelid::regclass::text,
             (SELECT string_agg(att.attname, '+' ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = k.attnum),
             c.confrelid::regclass::text,
             (SELECT string_agg(att.attname, '+' ORDER BY k.ord)
                FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att
                  ON att.attrelid = c.confrelid AND att.attnum = k.attnum)
           ) AS k
    FROM pg_constraint c
    WHERE c.contype     = 'f'
      AND c.confrelid   = 'users'::regclass
      AND c.confdeltype = 'a'
  ),
  expected(k) AS (
    VALUES ('personal_expense_entries.user_id->users.id'),
           ('personal_income_entries.user_id->users.id'),
           ('savings_goals.user_id->users.id')
  )
  SELECT
    (SELECT count(*) FROM actual),
    (SELECT count(*) FROM (SELECT k FROM actual   EXCEPT SELECT k FROM expected) s),
    (SELECT count(*) FROM (SELECT k FROM expected EXCEPT SELECT k FROM actual)   s),
    (SELECT coalesce(string_agg(k, ', ' ORDER BY k), '(ว่าง)') FROM actual)
  INTO actual_count, extra_count, missing_count, actual_list;

  IF extra_count <> 0 OR missing_count <> 0 OR actual_count <> 3 THEN
    RAISE EXCEPTION
      '0098: เซ็ต FK NO ACTION ไม่ตรงกับที่อนุมัติ — actual=% (%), เกิน=%, ขาด=% · หยุดเพื่อให้คนตรวจ',
      actual_count, actual_list, extra_count, missing_count;
  END IF;

  RAISE NOTICE '0098: ✓ set equality ผ่าน — FK NO ACTION 3 จุดตรงกับที่อนุมัติ (%)', actual_list;

  -- ── 2) แปลงทีละตาราง (ค้นชื่อ constraint เอง ไม่เดา) ──────────────────
  FOREACH t IN ARRAY expected_tables LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '0098: ไม่พบตาราง % — หยุด', t;
    END IF;

    SELECT c.conname, c.confdeltype, c.confupdtype,
           c.condeferrable, c.condeferred, c.confmatchtype
      INTO fk
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum   = c.conkey[1]
    WHERE c.contype    = 'f'
      AND c.conrelid   = t::regclass
      AND c.confrelid  = 'users'::regclass
      AND cardinality(c.conkey) = 1
      AND a.attname    = 'user_id';

    IF NOT FOUND THEN
      RAISE EXCEPTION '0098: ไม่พบ FK user_id → users(id) บนตาราง % — หยุด', t;
    END IF;

    -- ต้องชี้ users(id) เท่านั้น (ไม่ใช่คอลัมน์อื่นของ users)
    SELECT count(*) INTO n
    FROM pg_constraint c
    JOIN pg_attribute ra
      ON ra.attrelid = c.confrelid
     AND ra.attnum   = c.confkey[1]
    WHERE c.conname = fk.conname
      AND c.conrelid = t::regclass
      AND ra.attname = 'id';
    IF n <> 1 THEN
      RAISE EXCEPTION '0098: %.% ไม่ได้อ้างอิง users(id) — หยุด', t, fk.conname;
    END IF;

    IF fk.confdeltype = 'c' THEN
      RAISE NOTICE '0098: %.% เป็น CASCADE อยู่แล้ว — ข้าม', t, fk.conname;
      CONTINUE;
    END IF;

    IF fk.confdeltype <> 'a' THEN
      RAISE EXCEPTION '0098: %.% มี ON DELETE ที่ไม่คาดคิด (confdeltype=%) — หยุด',
        t, fk.conname, fk.confdeltype;
    END IF;
    IF fk.confupdtype <> 'a' THEN
      RAISE EXCEPTION '0098: %.% มี ON UPDATE ที่ไม่ใช่ NO ACTION (confupdtype=%) — หยุด',
        t, fk.conname, fk.confupdtype;
    END IF;
    IF fk.condeferrable OR fk.condeferred THEN
      RAISE EXCEPTION '0098: %.% เป็น DEFERRABLE/DEFERRED — หยุด', t, fk.conname;
    END IF;
    IF fk.confmatchtype <> 's' THEN
      RAISE EXCEPTION '0098: %.% ใช้ MATCH ที่ไม่ใช่ SIMPLE (confmatchtype=%) — หยุด',
        t, fk.conname, fk.confmatchtype;
    END IF;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, fk.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES users(id) '
      'MATCH SIMPLE ON UPDATE NO ACTION ON DELETE CASCADE',
      t, fk.conname
    );

    RAISE NOTICE '0098: %.% → ON DELETE CASCADE', t, fk.conname;
  END LOOP;

  -- ── 3) fail-closed: ยืนยันผลก่อน COMMIT ──────────────────────────────
  SELECT
    count(*) FILTER (WHERE confdeltype = 'c'),
    count(*) FILTER (WHERE confdeltype = 'n'),
    count(*) FILTER (WHERE confdeltype = 'a'),
    count(*)
  INTO cascade_after, setnull_after, noaction_after, total_after
  FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'users'::regclass;

  RAISE NOTICE '0098 AFTER : cascade=% setnull=% noaction=% total=%',
    cascade_after, setnull_after, noaction_after, total_after;

  IF total_after <> total_before THEN
    RAISE EXCEPTION '0098: จำนวน FK รวมเปลี่ยน (% → %) — มี constraint หายหรือเกิน หยุด',
      total_before, total_after;
  END IF;
  IF setnull_after <> setnull_before THEN
    RAISE EXCEPTION '0098: จำนวน SET NULL เปลี่ยน (% → %) — หยุด', setnull_before, setnull_after;
  END IF;
  IF cascade_after <> cascade_before + 3 THEN
    RAISE EXCEPTION '0098: CASCADE ควรเพิ่มขึ้น 3 (% → % ) — หยุด', cascade_before, cascade_after;
  END IF;

  -- กติกาถาวรของโปรเจกต์: FK → users(id) ต้องเป็น CASCADE หรือ SET NULL เท่านั้น
  IF noaction_after <> 0 THEN
    RAISE EXCEPTION '0098: ยังเหลือ FK NO ACTION % จุด — หยุด', noaction_after;
  END IF;

  RAISE NOTICE '0098: ✓ สำเร็จ — ลบบัญชีด้วย DELETE FROM users ทำได้แล้ว';
END $$;

COMMIT;
