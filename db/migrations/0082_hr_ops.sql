-- 0082_hr_ops — Staff Ops: พักเบรก + แจ้งเวลาไม่ตรง + ประกาศ + Checklist
--
-- หลักที่ยึด:
--   1) Break V1 = บันทึกอย่างเดียว ไม่หักเงิน (สเปคกำกับชัด) — regular/ot
--      minutes เดิมไม่เปลี่ยนสูตร · UI ห้ามสื่อว่าโดนหัก
--   2) สถานะพักใช้ break_started_at (NULL = ไม่ได้พัก) แทนการเพิ่มค่าใน
--      status enum — backward compatible 100%: partial unique กัน clock ซ้อน,
--      เงื่อนไข clock-out, payroll filter, exceptions ทุกตัวไม่ต้องแตะเลย
--   3) แจ้งเวลาไม่ตรง = คำขอ → owner อนุมัติ → ปรับผ่านระบบ adjustment เดิม
--      (Phase 2) — audit trail เส้นเดียวกัน ไม่มีทางแก้เวลาลัด
--   4) Checklist: template ต่อร้าน (แก้ได้) → รายการรายวันสร้างตอนเปิดดู
--      ผูกกับวันขาย · ปิดร้านไม่ครบ → เตือนตอน clock-out แต่ override ได้
--      พร้อมเหตุผล (ตัดสินไว้แล้ว: ไม่บล็อก)

BEGIN;

-- ═══ 1 · Break (บันทึกอย่างเดียว) ═══════════════════════════════

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attendance_break_minutes_check') THEN
    ALTER TABLE attendance ADD CONSTRAINT attendance_break_minutes_check
      CHECK (break_minutes >= 0);
  END IF;
END $$;

-- ═══ 2 · คำขอแก้เวลา (Attendance Correction Request) ═══════════

CREATE TABLE IF NOT EXISTS attendance_correction_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
  business_date DATE NOT NULL,
  kind          VARCHAR(20) NOT NULL
    CHECK (kind IN ('missing_clock_out', 'wrong_time', 'other')),
  requested_clock_in_at  TIMESTAMPTZ,
  requested_clock_out_at TIMESTAMPTZ,
  note          VARCHAR(255),
  status        VARCHAR(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note   VARCHAR(255),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR review_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_att_corrections_user
  ON attendance_correction_requests (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_att_corrections_employee
  ON attendance_correction_requests (employee_id, created_at DESC);

-- ═══ 3 · ประกาศจากร้าน ══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shop_announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(500) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_announcements_user
  ON shop_announcements (user_id, is_active, created_at DESC);

-- ═══ 4 · Checklist ══════════════════════════════════════════════

-- template ต่อร้าน — owner แก้/เพิ่ม/ปิดได้
CREATE TABLE IF NOT EXISTS shift_checklists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase      VARCHAR(10) NOT NULL CHECK (phase IN ('opening', 'during', 'closing')),
  title      VARCHAR(120) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_checklists_user
  ON shift_checklists (user_id, phase, sort_order);

-- รายการจริงรายวัน (สร้างตอนพนักงานเปิดดูครั้งแรกของวัน)
CREATE TABLE IF NOT EXISTS shift_checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES shift_checklists(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'verified')),
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  verified_at   TIMESTAMPTZ,        -- สำหรับ Manager (batch ถัดไป)
  verified_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  note          VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_checklist_items_user_date
  ON shift_checklist_items (user_id, business_date);

-- ═══ 5 · Seed checklist มาตรฐาน Ninenon ให้ร้านที่ใช้ POS ═══════
-- (เฉพาะร้านที่ยังไม่มี template เลย — ร้านที่แก้ของตัวเองแล้วไม่โดนทับ)

INSERT INTO shift_checklists (user_id, phase, title, sort_order)
SELECT s.user_id, t.phase, t.title, t.sort_order
FROM pos_shop_settings s
CROSS JOIN (VALUES
  ('opening', 'เปิด/ตรวจอุปกรณ์', 0), ('opening', 'ตรวจแก๊ส', 1),
  ('opening', 'ตรวจเตา', 2), ('opening', 'เตรียมเนื้อ', 3),
  ('opening', 'เตรียมไก่', 4), ('opening', 'เตรียมชีส', 5),
  ('opening', 'เตรียมผัก', 6), ('opening', 'เตรียมซอส', 7),
  ('opening', 'เตรียมขนมปัง', 8), ('opening', 'เตรียมเฟรนฟราย', 9),
  ('opening', 'ตรวจ POS', 10), ('opening', 'ตรวจ QR สั่งอาหาร', 11),
  ('opening', 'เตรียมบรรจุภัณฑ์', 12), ('opening', 'เช็ดโต๊ะ', 13),
  ('opening', 'เช็กพื้นที่หน้าร้าน', 14),
  ('during', 'ทำความสะอาดระหว่างงาน', 0), ('during', 'เติมวัตถุดิบ', 1),
  ('during', 'เติมบรรจุภัณฑ์', 2), ('during', 'ตรวจออเดอร์ค้าง', 3),
  ('during', 'ตรวจคุณภาพอาหาร', 4), ('during', 'ตรวจโต๊ะ', 5),
  ('during', 'ตรวจสต๊อก', 6),
  ('closing', 'ปิดเตา', 0), ('closing', 'ปิดแก๊ส', 1),
  ('closing', 'ล้างกระทะ', 2), ('closing', 'ล้างอุปกรณ์', 3),
  ('closing', 'เก็บวัตถุดิบเข้าที่', 4), ('closing', 'ตรวจตู้เย็น', 5),
  ('closing', 'กวาดพื้น', 6), ('closing', 'ถูพื้น', 7),
  ('closing', 'ทิ้งขยะ', 8), ('closing', 'จัดสต๊อก', 9),
  ('closing', 'ตรวจบิลค้าง', 10), ('closing', 'ตรวจออเดอร์ค้าง', 11),
  ('closing', 'ส่งสรุปกะ', 12)
) AS t(phase, title, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM shift_checklists c WHERE c.user_id = s.user_id
);

COMMIT;
