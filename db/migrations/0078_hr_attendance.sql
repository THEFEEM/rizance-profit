-- 0078_hr_attendance — HR Phase 2: ลงเวลาเข้า-ออกงาน
--
-- หลักที่ยึด:
--   1) เวลาเป็นของ server — client ไม่มีสิทธิ์ส่ง timestamp (clock_in_at/out_at
--      มาจาก now() ของ DB เท่านั้น · ยกเว้น owner ปรับมือซึ่งลง audit เสมอ)
--   2) กัน clock-in ซ้อนที่ DB — partial unique: พนักงาน 1 คนมี attendance
--      ที่ยังไม่ปิดได้แถวเดียว (แนวเดียวกับ open-order-per-table 0075)
--      โค้ดจับ 23505 + ชื่อ index นี้ → 409 already_working
--   3) business_date ใช้ cutoff เดิมของ POS (0067) — logic เดียวกับบิล
--   4) แก้มือ = ไม่เงียบ: attendance_adjustments เก็บค่าเดิม/ใหม่/เหตุผล/คนแก้
--   5) พร้อมต่อ payroll: เก็บ regular/ot minutes แยก · เกณฑ์ OT มาจาก
--      hr_settings (standard_day_minutes) ไม่ hardcode

BEGIN;

-- เกณฑ์ชั่วโมงงานปกติต่อวัน (เกินนี้ = OT) — config ต่อร้าน
ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS standard_day_minutes INTEGER NOT NULL DEFAULT 480;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'hr_settings_standard_day_minutes_check') THEN
    ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_standard_day_minutes_check
      CHECK (standard_day_minutes > 0 AND standard_day_minutes <= 1440);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,  -- snapshot ตอน clock in
  business_date DATE NOT NULL,                                    -- ตาม cutoff ร้าน
  clock_in_at   TIMESTAMPTZ NOT NULL,
  clock_out_at  TIMESTAMPTZ,
  total_minutes   INTEGER CHECK (total_minutes IS NULL OR total_minutes >= 0),
  regular_minutes INTEGER CHECK (regular_minutes IS NULL OR regular_minutes >= 0),
  ot_minutes      INTEGER CHECK (ot_minutes IS NULL OR ot_minutes >= 0),
  status        VARCHAR(15) NOT NULL DEFAULT 'working'
    CHECK (status IN ('working', 'completed', 'adjusted', 'cancelled')),
  source        VARCHAR(15) NOT NULL DEFAULT 'staff_link'
    CHECK (source IN ('staff_link', 'manager', 'system')),
  note          VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ปิดงานแล้วต้องมีตัวเลขครบ · ยกเลิกไม่ต้อง
  CHECK (clock_out_at IS NULL OR status = 'cancelled'
         OR (total_minutes IS NOT NULL AND regular_minutes IS NOT NULL
             AND ot_minutes IS NOT NULL)),
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

-- ⚠️ ชื่อ index นี้ถูกโค้ดใช้จับ error — เปลี่ยนชื่อ = กันซ้อนเงียบ ๆ กลายเป็น 500
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_open_once
  ON attendance (employee_id)
  WHERE clock_out_at IS NULL AND status = 'working';

CREATE INDEX IF NOT EXISTS idx_attendance_user_date
  ON attendance (user_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
  ON attendance (employee_id, business_date DESC);

-- แก้มือทุกครั้งมีรอย — append-only
CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  actor         VARCHAR(10) NOT NULL CHECK (actor IN ('owner', 'system')),
  before        JSONB NOT NULL,
  after         JSONB NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_attendance
  ON attendance_adjustments (attendance_id, created_at DESC);

COMMIT;
