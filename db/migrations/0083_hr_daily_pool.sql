-- 0083_hr_daily_pool — Payroll V1 แบบเงินกองกลางรายวัน (Daily Labor Pool)
--
-- ═══ หลักที่ยึด ═══════════════════════════════════════════════
-- 1) ไม่สร้าง payroll ซ้ำ: payroll_periods / payroll_items / adjust_lines
--    (0080) ยังเป็นตัวจริงทั้ง state machine · immutable · expense · audit
--    ตารางใหม่คือ "ที่มาของตัวเลข" เท่านั้น
-- 2) โหมดต่อร้าน: hourly (ของเดิม ผ่านเทสแล้ว) กับ daily_pool (Ninenon)
--    default = hourly → ร้านอื่นไม่กระทบเลย backward compatible
-- 3) เงินกองกลางมีเวอร์ชัน (effective_from) — แก้เงินวันเสาร์วันนี้
--    ไม่ย้อนไปเปลี่ยน payroll ของอดีต
-- 4) ค่าแรงรายชั่วโมงเดิม (employees.wage_rate / employee_wage_history)
--    ไม่ถูกลบ — เก็บเป็นข้อมูล HR ต่อไป แค่ไม่ใช้คิดเงินในโหมด pool
-- 5) หนึ่งคน หนึ่งวัน หนึ่งรายการ (unique) — คำนวณซ้ำได้ ไม่มีทางเบิ้ล

BEGIN;

-- ═══ 1 · โหมดจ่ายเงิน + อัตราผู้จัดการ + ประเภทลาที่ได้เงิน ═════

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS payroll_mode VARCHAR(12) NOT NULL DEFAULT 'hourly';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_settings_payroll_mode_check') THEN
    ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_payroll_mode_check
      CHECK (payroll_mode IN ('hourly', 'daily_pool'));
  END IF;
END $$;

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS manager_daily_rate NUMERIC(12,2) NOT NULL DEFAULT 200;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_settings_manager_daily_rate_check') THEN
    ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_manager_daily_rate_check
      CHECK (manager_daily_rate >= 0);
  END IF;
END $$;

-- ประเภทลาที่ยังได้รับส่วนแบ่ง — default ว่าง = ลาแล้วไม่ได้เงิน
-- (สเปคสั่งห้ามเดา: เจ้าของร้านเป็นคนเลือกเอง)
ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS paid_leave_types JSONB NOT NULL DEFAULT '[]';

-- ═══ 2 · เงินกองกลางต่อวันในสัปดาห์ (มีเวอร์ชัน) ════════════════
-- day_of_week: 0 = อาทิตย์ … 6 = เสาร์ (ตรงกับ EXTRACT(DOW))

CREATE TABLE IF NOT EXISTS daily_pool_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id      UUID REFERENCES branches(id) ON DELETE CASCADE,
  day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  pool_amount    NUMERIC(12,2) NOT NULL CHECK (pool_amount >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_of_week, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_daily_pool_config_lookup
  ON daily_pool_config (user_id, day_of_week, effective_from DESC);

-- ═══ 3 · ผลการแบ่งเงินรายวัน (คำนวณใหม่ได้ · ยังไม่ผูกงวด) ═════

CREATE TABLE IF NOT EXISTS daily_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  business_date     DATE NOT NULL,
  kind              VARCHAR(8) NOT NULL CHECK (kind IN ('staff', 'manager')),
  pool_amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pool_amount >= 0),
  eligible_count    INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  allocation_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allocation_amount >= 0),
  attendance_status VARCHAR(12) NOT NULL
    CHECK (attendance_status IN ('present', 'absent', 'leave_paid', 'leave_unpaid')),
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_date, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_allocations_user_date
  ON daily_allocations (user_id, business_date);
CREATE INDEX IF NOT EXISTS idx_daily_allocations_employee
  ON daily_allocations (employee_id, business_date DESC);

-- ═══ 4 · seed เงินกองกลางของ Ninenon ให้ร้านที่ใช้ POS ══════════
-- อา–พุธ ฿450 · พฤ–ศ ฿200 · เสาร์ ฿400 (แก้ได้ในหน้าตั้งค่า)
-- ⚠️ ไม่เปลี่ยนโหมดให้อัตโนมัติ — ร้านต้องเลือก daily_pool เอง
--    (ร้านที่ใช้รายชั่วโมงอยู่จะไม่โดนเปลี่ยนวิธีจ่ายเงินโดยไม่รู้ตัว)

INSERT INTO daily_pool_config (user_id, day_of_week, pool_amount, effective_from)
SELECT s.user_id, d.dow, d.amount, DATE '2000-01-01'
FROM pos_shop_settings s
CROSS JOIN (VALUES
  (0, 450), (1, 450), (2, 450), (3, 450), (4, 200), (5, 200), (6, 400)
) AS d(dow, amount)
WHERE NOT EXISTS (
  SELECT 1 FROM daily_pool_config c WHERE c.user_id = s.user_id
);

COMMIT;
