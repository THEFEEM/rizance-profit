-- 0081_hr_leave — HR Phase 5: การลา + ข้อยกเว้นเวลาทำงาน
--
-- หลักที่ยึด:
--   1) อนุมัติลา = สร้างแถว attendance status 'leave' รายวัน (ไม่มี clock)
--      → ตารางเดิมทุกที่ (dashboard/exceptions/payroll) เห็นทันทีโดยไม่ต้อง
--        แก้ query เดิม · Phase 2 มี 'leave' ใน CHECK อยู่แล้ว
--   2) กะไม่ถูกลบเมื่ออนุมัติลา — เปลี่ยนสถานะเป็น 'leave' (ประวัติตารางคงอยู่)
--   3) ลาไม่สร้างค่าแรงเอง: แถว leave มี regular/ot = NULL → payroll engine
--      (Phase 4) กรอง WHERE status IN ('completed','adjusted') อยู่แล้ว
--      = ไม่ต้องแตะ payroll engine เลย
--   4) ลาทับซ้อน: ตรวจฝั่ง server (pending + approved) — daterange overlap

BEGIN;

-- attendance status += 'leave' (additive — ค่าเดิมทั้ง 4 ยังใช้ได้เหมือนเดิม)
DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'attendance'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%working%'
    AND pg_get_constraintdef(oid) LIKE '%cancelled%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE attendance DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
    CHECK (status IN ('working', 'completed', 'adjusted', 'cancelled', 'leave'));
END $$;

-- shift status += 'leave' (additive — ของเดิมไม่กระทบ)
DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con FROM pg_constraint
  WHERE conrelid = 'shifts'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%scheduled%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shifts DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE shifts ADD CONSTRAINT shifts_status_check
    CHECK (status IN ('scheduled','working','completed','absent','cancelled','leave'));
END $$;

CREATE TABLE IF NOT EXISTS leave_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,
  leave_type   VARCHAR(20) NOT NULL,     -- ตาม hr_settings.leave_types (ไม่ hardcode ใน CHECK)
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL CHECK (end_date >= start_date),
  reason       VARCHAR(255),
  status       VARCHAR(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by  VARCHAR(10) CHECK (reviewed_by IS NULL OR reviewed_by IN ('owner')),
  reviewed_at  TIMESTAMPTZ,
  review_note  VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ปฏิเสธต้องมีเหตุผลเสมอ
  CHECK (status <> 'rejected' OR review_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user
  ON leave_requests (user_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee
  ON leave_requests (employee_id, start_date DESC);
-- ช่วงวันที่ที่ยัง "นับอยู่" (pending/approved) — ใช้เช็คทับซ้อน
CREATE INDEX IF NOT EXISTS idx_leave_requests_active_range
  ON leave_requests (employee_id, start_date, end_date)
  WHERE status IN ('pending', 'approved');

-- attendance อ้างใบลาที่ทำให้เกิดแถวนี้ (แถว status='leave')
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS leave_id UUID REFERENCES leave_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_leave
  ON attendance (leave_id) WHERE leave_id IS NOT NULL;

-- แถวลา: ไม่มี clock_out และไม่มีตัวเลขชั่วโมง — CHECK เดิมของ 0078 บังคับ
-- (clock_out_at IS NULL → ผ่าน) · clock_in_at NOT NULL อยู่แล้ว จึงใช้
-- เที่ยงวันของวันลาเป็น placeholder (โค้ดตั้งให้ ไม่ใช่เวลาจริงที่ใครกด)
-- หนึ่งวันลา = หนึ่งแถวต่อพนักงาน
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_leave_once_per_day
  ON attendance (employee_id, business_date)
  WHERE status = 'leave';

COMMIT;
