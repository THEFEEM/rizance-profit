-- 0084_manager_duty — Manager Duty: เช็กลิสต์ของผู้จัดการ
--
-- ═══ ที่มา (25 ส.ค. 2569) ═══════════════════════════════════════
-- 0082 วางเช็กลิสต์ไว้เป็นงานของ "พนักงาน" 35 ข้อ (เปิดร้าน 15 / ระหว่างวัน 7 / ปิดร้าน 13)
-- และบล็อกการเลิกงานถ้างานปิดร้านไม่ครบ
--
-- ตัดสินใจใหม่: การตรวจสอบเป็นหน้าที่ของ "ผู้จัดการ" ไม่ใช่พนักงานรายวัน
--   → พนักงานเลิกงานได้เลย ไม่มีด่านเช็กลิสต์
--   → ผู้จัดการมีเช็กลิสต์ของตัวเอง 11 ข้อ ทำเหมือนกันทุกรอบ (฿200/รอบ)
--
-- ═══ สิ่งที่ทำ ═════════════════════════════════════════════════
-- 1) เพิ่ม phase 'manager' (สลับ CHECK แบบ additive — ค่าเดิมยังใช้ได้ครบ)
-- 2) ปิด template เดิมทั้งหมด (is_active = false) — ไม่ลบ ประวัติการติ๊กยังอยู่
-- 3) seed 11 ข้อ Manager Duty
--
-- ไม่แตะ shift_checklist_items เลย — completed_by ผูกกับ employees อยู่แล้ว
-- และ UNIQUE (template_id, business_date) ยังถูกต้อง: 1 รอบ = 1 วัน
--
-- ═══ ย้อนกลับได้ไหม ═══════════════════════════════════════════
-- ได้ — UPDATE shift_checklists SET is_active = true WHERE phase <> 'manager'
-- ข้อมูลการติ๊กเดิมไม่ถูกลบ

BEGIN;

-- ── 1. เพิ่ม phase 'manager' (additive — ค่าเดิมทั้ง 3 ยังใช้ได้เหมือนเดิม) ──
-- ใช้วิธีเดียวกับ 0081: หาชื่อ constraint จาก catalog แทนการเดาชื่อ
-- เพราะ Postgres ตั้งชื่อ CHECK แบบ inline ให้เอง ไม่การันตีว่าจะชื่ออะไร

DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'shift_checklists'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%opening%'
    AND pg_get_constraintdef(oid) LIKE '%closing%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shift_checklists DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE shift_checklists ADD CONSTRAINT shift_checklists_phase_check
    CHECK (phase IN ('opening', 'during', 'closing', 'manager'));
END $$;

-- ── 2. ปิดเช็กลิสต์เดิมของพนักงาน ───────────────────────────────
-- ไม่ลบ: ถ้าวันหนึ่งอยากเปิดใช้อีก แค่ set is_active = true
-- ผลทันที: closingRemaining() = 0 เสมอ → ด่านเลิกงานผ่านตลอด

UPDATE shift_checklists
SET is_active = false, updated_at = now()
WHERE phase IN ('opening', 'during', 'closing') AND is_active;

-- ── 3. seed 11 ข้อ Manager Duty ─────────────────────────────────
-- ลำดับสำคัญ: เช็กสต็อกมาก่อนซื้อของ (ไม่รู้ว่าเหลืออะไร จะซื้อถูกได้ยังไง)
-- seed ให้ทุกร้านเหมือนที่ 0082 ทำ — เจ้าของแก้/ปิดเองได้จากหน้าจัดการ Checklist
-- ON CONFLICT ไม่ต้องมี เพราะ WHERE NOT EXISTS กันซ้ำแล้ว (รันซ้ำได้ปลอดภัย)

INSERT INTO shift_checklists (user_id, phase, title, sort_order)
SELECT s.user_id, 'manager', t.title, t.sort_order
FROM pos_shop_settings s
CROSS JOIN (VALUES
  ('เช็กสต็อกคงเหลือในระบบ',              0),
  ('ซื้อของตามรายการที่ขาด',               1),
  ('รับของ + ตรวจของเสีย/ใกล้หมดอายุ',      2),
  ('บันทึกของเข้าในระบบคลัง',              3),
  ('ทำซอส',                                4),
  ('ตรวจ Prep (เนื้อ/ไก่/ผัก/ขนมปัง)',      5),
  ('ตรวจความสะอาด',                        6),
  ('ตรวจอุปกรณ์ (เตา/แก๊ส/ตู้เย็น)',        7),
  ('ตรวจเงินสดกับยอด POS ให้ตรงกัน',        8),
  ('ดูยอดผิดปกติ / ออเดอร์ค้าง',            9),
  ('สรุปปัญหาที่เจอ ส่งให้เจ้าของ',         10)
) AS t(title, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM shift_checklists c
  WHERE c.user_id = s.user_id AND c.phase = 'manager' AND c.title = t.title
);

COMMIT;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════
-- ต้องได้: manager 11 ข้อ active · เดิมทั้งหมด inactive
--
-- SELECT phase, COUNT(*) FILTER (WHERE is_active) AS active,
--                COUNT(*) FILTER (WHERE NOT is_active) AS inactive
-- FROM shift_checklists GROUP BY phase ORDER BY phase;
