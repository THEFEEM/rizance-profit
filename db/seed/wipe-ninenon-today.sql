-- wipe-ninenon-today — ล้างข้อมูลเทส "เฉพาะวันนี้" ของ NINENON BURGER
--
-- ⚠️ ปุ่ม "ล้างข้อมูลเทส" ในแอปใช้ไม่ได้แล้ว (กดเปิดร้านจริง 27 ก.ค. 2569 → ล็อกถาวร)
--    และปุ่มนั้นล้าง "ทั้งหมด" ไม่ใช่แค่วันนี้ → ต้องใช้ SQL เจาะจงวันแทน
--
-- ขอบเขต: user = ninenon2026@gmail.com · วันที่ = 2026-07-29 (แก้ตัวแปร d ได้)
--   ลบ: บิล+รายการ+payments · journal ของบิลเหล่านั้น · income_entries ที่ผูก
--       · stock movement ที่เกิดจากบิล · ออเดอร์ QR ที่สร้างวันนี้ (แชท/รีวิว
--         หายตาม CASCADE) · เลขรันของวันนี้
--   ไม่ลบ: สินค้า หมวด ตัวเลือก วัตถุดิบ สูตร ตั้งค่าร้าน คนส่ง
--          และ **ข้อมูลวันอื่น** (26-28 ก.ค.) ไม่ถูกแตะ
--
-- ทำใน transaction เดียว — พลาดตรงไหน rollback หมด
-- รันแล้วดูผลบรรทัดล่างสุด (ต้องเหลือ 0 ทุกช่อง)

BEGIN;

DO $$
DECLARE
  uid  UUID;
  d    DATE := DATE '2026-07-29';   -- ← วันที่ต้องการล้าง
  bill_ids UUID[];
  n_bills INT; n_orders INT; n_income INT; n_journal INT;
  n_posmv INT; n_ingmv INT;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'ninenon2026@gmail.com';
  IF uid IS NULL THEN RAISE EXCEPTION 'ไม่พบ user'; END IF;

  -- บิลของวันนี้ (อ้างอิงทุกขั้นตอนถัดไป)
  SELECT COALESCE(array_agg(id), '{}') INTO bill_ids
  FROM pos_bills WHERE user_id = uid AND entry_date = d;

  RAISE NOTICE 'พบบิลวันที่ % จำนวน % ใบ', d, COALESCE(array_length(bill_ids, 1), 0);

  -- 1) journal — ปลด self-FK ก่อน ไม่งั้นคู่ปิดบิล/ยกเลิกลบไม่ได้
  UPDATE journal_entries SET reversed_by_entry_id = NULL
  WHERE user_id = uid AND source_module = 'pos'
    AND source_event_id = ANY(bill_ids);

  DELETE FROM journal_lines
  WHERE entry_id IN (
    SELECT id FROM journal_entries
    WHERE user_id = uid AND source_module = 'pos'
      AND source_event_id = ANY(bill_ids));

  DELETE FROM journal_entries
  WHERE user_id = uid AND source_module = 'pos'
    AND source_event_id = ANY(bill_ids);
  GET DIAGNOSTICS n_journal = ROW_COUNT;

  -- 2) income entries ที่บิล/payments อ้างถึง (FK เป็น SET NULL → ลบก่อนบิลได้)
  DELETE FROM income_entries
  WHERE id IN (
    SELECT b.income_entry_id FROM pos_bills b
    WHERE b.id = ANY(bill_ids) AND b.income_entry_id IS NOT NULL
    UNION
    SELECT p.income_entry_id FROM pos_bill_payments p
    WHERE p.bill_id = ANY(bill_ids) AND p.income_entry_id IS NOT NULL);
  GET DIAGNOSTICS n_income = ROW_COUNT;

  -- 3) การเคลื่อนไหวสต็อกที่เกิดจากบิลเหล่านี้ (สินค้า + วัตถุดิบ)
  DELETE FROM pos_stock_movements WHERE user_id = uid AND bill_id = ANY(bill_ids);
  GET DIAGNOSTICS n_posmv = ROW_COUNT;

  DELETE FROM ingredient_stock_movements WHERE user_id = uid AND bill_id = ANY(bill_ids);
  GET DIAGNOSTICS n_ingmv = ROW_COUNT;

  -- 4) ออเดอร์ QR ที่สร้างวันนี้ — items / modifiers / แชท / รีวิว หายตาม CASCADE
  DELETE FROM pos_orders
  WHERE user_id = uid AND created_at >= d AND created_at < d + 1;
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  -- 5) บิล (items / item_modifiers / payments หายตาม CASCADE)
  DELETE FROM pos_bills WHERE id = ANY(bill_ids);
  GET DIAGNOSTICS n_bills = ROW_COUNT;

  -- 6) เลขรันของวันนี้ — พรุ่งนี้เริ่ม 001 ใหม่ตามปกติ
  DELETE FROM pos_bill_counters  WHERE user_id = uid AND counter_date = d;
  DELETE FROM pos_order_counters WHERE user_id = uid AND counter_date = d;

  RAISE NOTICE 'ลบแล้ว — บิล % · ออเดอร์ % · income % · journal % · stock(สินค้า) % · stock(วัตถุดิบ) %',
    n_bills, n_orders, n_income, n_journal, n_posmv, n_ingmv;
END $$;

COMMIT;

-- ตรวจผล: ต้องได้ 0 ทุกช่อง
SELECT
  (SELECT count(*) FROM pos_bills
     WHERE user_id = (SELECT id FROM users WHERE email='ninenon2026@gmail.com')
       AND entry_date = DATE '2026-07-29')                          AS bills_today,
  (SELECT count(*) FROM pos_orders
     WHERE user_id = (SELECT id FROM users WHERE email='ninenon2026@gmail.com')
       AND created_at >= DATE '2026-07-29'
       AND created_at <  DATE '2026-07-29' + 1)                     AS orders_today,
  (SELECT count(*) FROM journal_entries
     WHERE user_id = (SELECT id FROM users WHERE email='ninenon2026@gmail.com')
       AND source_module = 'pos' AND entry_date = DATE '2026-07-29') AS journal_today,
  (SELECT count(*) FROM income_entries
     WHERE user_id = (SELECT id FROM users WHERE email='ninenon2026@gmail.com')
       AND entry_date = DATE '2026-07-29')                          AS income_today;
