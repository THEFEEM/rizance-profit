-- 0092_split_cash_from_duty — แยก Daily Cash Closing ออกจาก Manager Duty
--
-- ═══ ที่มา (28 ส.ค. 2569 — Dev ยืนยัน 3 decision) ═══════════════════
-- Manager Duty = Operational Control · Daily Cash Closing = Financial Control
-- สองระบบต้องไม่บังคับกัน:
--   · ร้านปิดเงินสดได้ทุกวันที่เปิดขาย แม้วันนั้นไม่มีรอบผู้จัดการ
--   · ผู้จัดการปิดรอบได้แม้ยังไม่เช็คเงินสด (ไม่เคยบังคับอยู่แล้ว — ยืนยันจาก audit)
--
-- AUDIT พบว่า engine แยกกันอยู่แล้ว (completeDuty ไม่บังคับข้อครบ ·
-- startCashCheck ไม่แตะ duty · daily_cash_checks.duty_id ไม่เคยถูกเขียนค่า)
-- migration นี้จึงเป็น "data + comment เท่านั้น" — ไม่มี schema change
--
-- ═══ สิ่งที่ทำ ═══════════════════════════════════════════════════
-- 1) soft disable ข้อ "ตรวจเงินสดกับยอด POS ให้ตรงกัน" ใน template ผู้จัดการ
--    (เช็คเงินสดย้ายไปเป็นโมดูล Cash Control ของ POS — /cash)
--    · ตัดสินใจ: ข้อ "ดูยอดผิดปกติ / ออเดอร์ค้าง" คงไว้ — เป็น operational review
--    · ใช้ exact title ตาม seed 0084 — ถ้าเจ้าของแก้ชื่อข้อเองไปแล้ว ถือเป็น
--      ของที่เจ้าของดูแลเอง migration ไม่แตะ (และไม่มีทางไปโดนข้ออื่นผิดตัว)
-- 2) COMMENT deprecated ที่ daily_cash_checks.duty_id — ไม่ drop column
--
-- ═══ สิ่งที่ "ไม่" ทำ ═════════════════════════════════════════════
-- ✗ ไม่ลบแถว template (soft disable — เปิดคืนได้ด้วย is_active = true)
-- ✗ ไม่แตะ manager_duties / manager_duty_items เดิม — duty ที่ snapshot
--   ข้อเงินสดไว้แล้วคงอยู่ตามเดิมทุกแถว (ห้าม rewrite history)
--   completeCashCheck จะ auto-done ข้อนั้นใน duty เก่าได้ต่อไป (System Evidence)
--   ส่วน duty ใหม่ไม่มีข้อนี้ให้ติ๊ก → query เดิมกลายเป็น no-op เองอย่างปลอดภัย
-- ✗ ไม่แตะ daily_cash_checks ที่ปิดแล้ว (snapshot ถาวร)
-- ✗ ไม่แตะ payroll / approvals
--
-- ═══ ย้อนกลับได้ไหม ═════════════════════════════════════════════
-- ได้ — UPDATE shift_checklists SET is_active = true
--        WHERE phase = 'manager' AND title = 'ตรวจเงินสดกับยอด POS ให้ตรงกัน';
-- รันซ้ำได้ (idempotent): เงื่อนไข AND is_active ทำให้รอบสองเป็น 0 แถว

BEGIN;

-- ── 1. ปิดข้อเช็คเงินสดใน template ผู้จัดการ (ทุกร้าน) ─────────────
-- shift_checklists.updated_at มีจริงตั้งแต่ 0082 (ตรวจแล้ว) — อ้างได้

UPDATE shift_checklists
SET is_active = false, updated_at = now()
WHERE phase = 'manager'
  AND title = 'ตรวจเงินสดกับยอด POS ให้ตรงกัน'
  AND is_active;

-- ── 2. ทำเครื่องหมายคอลัมน์ที่ไม่ใช้ ────────────────────────────────
-- ไม่ drop: ปลอดภัยกว่า และแถวเก่าทั้งหมดเป็น NULL อยู่แล้ว (ไม่เคยถูกเขียน)

COMMENT ON COLUMN daily_cash_checks.duty_id IS
  'DEPRECATED (0092): ไม่เคยถูกเขียนค่า — Cash Closing เป็น Financial Control อิสระจาก Manager Duty ห้ามเริ่มใช้ใหม่';

-- ── 3. ตรวจตัวเองก่อน COMMIT — ผิดคาดให้ล้มทั้งก้อน ─────────────────

DO $$
DECLARE
  cash_active INTEGER;
  ops_missing INTEGER;
BEGIN
  -- ข้อเช็คเงินสดต้องไม่เหลือ active แม้แต่ร้านเดียว
  SELECT COUNT(*) INTO cash_active
  FROM shift_checklists
  WHERE phase = 'manager'
    AND title = 'ตรวจเงินสดกับยอด POS ให้ตรงกัน'
    AND is_active;
  IF cash_active > 0 THEN
    RAISE EXCEPTION '0092: ข้อเช็คเงินสดยัง active อยู่ % แถว', cash_active;
  END IF;

  -- ข้อ operational review ต้องยัง active ครบทุกร้านที่มี template ผู้จัดการ
  -- (ร้านไหนมี seed 0084 แต่ข้อยอดผิดปกติหาย/โดนปิด = migration นี้ทำพัง → ล้ม)
  SELECT COUNT(DISTINCT s.user_id) INTO ops_missing
  FROM shift_checklists s
  WHERE s.phase = 'manager'
    AND NOT EXISTS (
      SELECT 1 FROM shift_checklists o
      WHERE o.user_id = s.user_id AND o.phase = 'manager'
        AND o.title = 'ดูยอดผิดปกติ / ออเดอร์ค้าง' AND o.is_active
    );
  IF ops_missing > 0 THEN
    RAISE EXCEPTION '0092: ข้อ "ดูยอดผิดปกติ / ออเดอร์ค้าง" หายจาก % ร้าน', ops_missing;
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน (บน Supabase)
-- ══════════════════════════════════════════════════════════════════
--
-- 1) template ผู้จัดการต้องเหลือ active 10 ข้อ (จาก 11) และข้อที่หาย
--    ต้องเป็น "ตรวจเงินสดกับยอด POS ให้ตรงกัน" เท่านั้น
--
-- SELECT title, is_active FROM shift_checklists
-- WHERE phase = 'manager' ORDER BY sort_order;
--
-- 2) duty เก่าไม่ถูกแตะ — จำนวน manager_duty_items ต้องเท่าก่อนรันเป๊ะ
--
-- SELECT COUNT(*) FROM manager_duty_items;
--
-- 3) เช็คเงินสดที่ปิดแล้วไม่ขยับ
--
-- SELECT business_date, expected_cash, actual_cash, difference
-- FROM daily_cash_checks WHERE status = 'completed' ORDER BY business_date;
