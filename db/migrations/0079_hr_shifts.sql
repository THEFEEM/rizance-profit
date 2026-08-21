-- 0079_hr_shifts — HR Phase 3: ตารางกะ + เทียบเวลาจริงกับกะ
--
-- หลักที่ยึด:
--   1) Template = ค่าเริ่มต้นไว้กดเร็ว · Shift = ตารางจริงรายวัน (copy ค่ามา
--      ตอนสร้าง ไม่ผูกแข็ง — แก้กะรายวันได้อิสระ template เปลี่ยนทีหลังไม่กระทบ)
--   2) เวลากะเก็บเป็นนาทีจากเที่ยงคืน (start_min/end_min) แบบเดียวกับ
--      pos_campaigns time window — end < start = ข้ามเที่ยงคืน
--   3) Attendance อ้าง shift (attendance.shift_id) ไม่ copy — walk-in = NULL
--   4) late/early ตัดสินที่ server ตอน clock in/out เก็บเป็นตัวเลขบนแถว
--      attendance (สรุป/payroll อ่านตรงได้ ไม่ต้องคำนวณใหม่)
--   5) ไม่ auto-mark absent — owner กดเอง (auto_absent_enabled เตรียมไว้
--      default ปิด · engine เป็นงานอนาคต)
--   6) กะซ้อน: ตรวจฝั่ง server ใน transaction (DB constraint แบบ EXCLUDE
--      ต้องใช้ btree_gist ซึ่งไม่การันตีทุก environment — บันทึกไว้เป็น
--      ข้อจำกัดที่ยอมรับ · race window แคบและเกิดจาก owner คนเดียวกัน)

BEGIN;

-- ═══ 1 · การตั้งค่าใหม่ (config ไม่ hardcode) ═══════════════════

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS allow_unscheduled_clock_in BOOLEAN NOT NULL DEFAULT true;
-- true = พฤติกรรมเดิมของ Phase 2 (walk-in ได้) — ปิดได้ถ้าร้านคุมเข้ม
ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS auto_absent_enabled BOOLEAN NOT NULL DEFAULT false;

-- ═══ 2 · Shift templates ═══════════════════════════════════════

CREATE TABLE IF NOT EXISTS shift_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  name          VARCHAR(60) NOT NULL,
  start_min     SMALLINT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min       SMALLINT NOT NULL CHECK (end_min BETWEEN 0 AND 1439),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_user
  ON shift_templates (user_id, is_active, name);

-- ═══ 3 · Shifts (ตารางจริงรายวัน) ═══════════════════════════════

CREATE TABLE IF NOT EXISTS shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  template_id   UUID REFERENCES shift_templates(id) ON DELETE SET NULL, -- ที่มา (หลวม ๆ)
  business_date DATE NOT NULL,
  start_min     SMALLINT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min       SMALLINT NOT NULL CHECK (end_min BETWEEN 0 AND 1439),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  status        VARCHAR(12) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'working', 'completed', 'absent', 'cancelled')),
  note          VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shifts_user_date
  ON shifts (user_id, business_date, start_min);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_date
  ON shifts (employee_id, business_date);

-- ═══ 4 · Attendance ↔ Shift ═════════════════════════════════════

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL;
-- late/early: NULL = walk-in (ไม่มีกะให้เทียบ) · 0 = ตรงเวลา · >0 = นาทีที่สาย/ออกก่อน
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS late_minutes INTEGER
    CHECK (late_minutes IS NULL OR late_minutes >= 0);
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS early_leave_minutes INTEGER
    CHECK (early_leave_minutes IS NULL OR early_leave_minutes >= 0);

CREATE INDEX IF NOT EXISTS idx_attendance_shift
  ON attendance (shift_id) WHERE shift_id IS NOT NULL;

COMMIT;
