-- 0080_hr_payroll — HR Phase 4: Payroll → Rizance Expense
--
-- หลักที่ยึด:
--   1) State machine: draft → review → approved → posted (+ cancelled จาก
--      draft/review) · หลัง approve/post = immutable ทุก field เงิน
--   2) Snapshot ทุกอย่างลง payroll_items — พนักงาน/ค่าแรงเปลี่ยนทีหลัง
--      ประวัติเงินเดือนห้ามเปลี่ยนตาม
--   3) Invariant การเงิน (บังคับทั้ง CHECK + server tx):
--      Σ payroll_items.net_pay = payroll_periods.total_amount
--                              = expense_entries.amount
--   4) Idempotency แบบเดียวกับ Finance เดิม: UNIQUE งวดต่อร้าน + atomic gate
--      (UPDATE ... WHERE expense_entry_id IS NULL) — retry approve ไม่สร้าง
--      expense ซ้ำ
--   5) expense ที่ลิงก์กับ payroll ห้ามถูกลบ (FK RESTRICT) — ลบ expense
--      ทิ้งเฉย ๆ = invariant พัง

BEGIN;

CREATE TABLE IF NOT EXISTS payroll_periods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL CHECK (period_end >= period_start),
  status           VARCHAR(10) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'posted', 'cancelled')),
  total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  expense_entry_id UUID REFERENCES expense_entries(id) ON DELETE RESTRICT,
  approved_at      TIMESTAMPTZ,
  posted_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- posted แล้วต้องมี expense เสมอ
  CHECK (status <> 'posted' OR expense_entry_id IS NOT NULL)
);

-- งวดซ้ำ (ร้านเดียว ช่วงเดียวกัน) สร้างไม่ได้ — ยกเว้นงวดที่ยกเลิกไปแล้ว
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_periods_unique
  ON payroll_periods (user_id, period_start, period_end)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_payroll_periods_user
  ON payroll_periods (user_id, period_start DESC);

CREATE TABLE IF NOT EXISTS payroll_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id              UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- RESTRICT: ประวัติเงินเดือนต้องชี้พนักงานได้เสมอ (ระบบไม่ลบพนักงานอยู่แล้ว)
  employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name_snapshot VARCHAR(120) NOT NULL,
  wage_type              VARCHAR(10) NOT NULL CHECK (wage_type IN ('hourly','daily','monthly')),
  wage_rate_snapshot     NUMERIC(12,2) NOT NULL,   -- อัตราล่าสุดในงวด (รายละเอียดราย rate อยู่ใน breakdown)
  regular_minutes        INTEGER NOT NULL DEFAULT 0 CHECK (regular_minutes >= 0),
  ot_minutes             INTEGER NOT NULL DEFAULT 0 CHECK (ot_minutes >= 0),
  days_worked            INTEGER NOT NULL DEFAULT 0 CHECK (days_worked >= 0),
  regular_amount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (regular_amount >= 0),
  ot_amount              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ot_amount >= 0),
  bonus_amount           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  deduction_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  gross_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay                NUMERIC(12,2) NOT NULL DEFAULT 0,
  /** trace เงิน→เวลา: [{date, minutes, otMinutes, rate, amount, otAmount}] +
      ราย attendance id ที่เป็นต้นทาง */
  breakdown              JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id),
  -- invariant ระดับแถว — DB ปฏิเสธเลขที่บวกไม่ลงตัวไม่ว่ามาจากทางไหน
  CHECK (gross_amount = regular_amount + ot_amount),
  CHECK (net_pay = gross_amount + bonus_amount - deduction_amount),
  CHECK (net_pay >= 0)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_period ON payroll_items (period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee
  ON payroll_items (employee_id, created_at DESC);

-- โบนัส/หักเงิน manual — ต้องมีเหตุผลเสมอ (Incentive engine อัตโนมัติ = Phase หลัง)
CREATE TABLE IF NOT EXISTS payroll_adjust_lines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID NOT NULL REFERENCES payroll_items(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(10) NOT NULL CHECK (kind IN ('bonus', 'deduction')),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason     VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjust_lines_item
  ON payroll_adjust_lines (item_id);

COMMIT;
