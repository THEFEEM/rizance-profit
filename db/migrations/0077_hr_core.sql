-- 0077_hr_core — HR Phase 1: สาขา + ทะเบียนพนักงาน + Staff Identity
--
-- สถาปัตยกรรม (อนุมัติ 21 ส.ค. 2569 · docs/hr-module-audit.md):
--   tenancy  : user_id = business (ตาม convention เดิม 1 user = 1 shop)
--              + branches เป็น dimension ใหม่ — วันนี้ Ninenon = 1 สาขา
--              อนาคต Business → Branch → Employee ได้โดยไม่ rewrite
--   identity : staff เข้าผ่านลิงก์ /e/<token> (แนว pos_riders) แต่ยกระดับ:
--              เก็บ SHA-256 hash ไม่เก็บ token ตรง ๆ (DB หลุด = ลิงก์ไม่หลุด)
--              + วันหมดอายุ (ไม่ใช่ permanent credential) + rotate ได้
--   audit    : ค่าแรงเปลี่ยน → history อัตโนมัติ (trigger แบบ 0076)
--              การกระทำสำคัญ → hr_audit_logs
--
-- ⚠️ ไม่แตะตารางเดิมใด ๆ ทั้งสิ้น · ไม่แตะ invariant บัญชี

BEGIN;

-- ═══ 1 · สาขา ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_branches_user ON branches (user_id, sort_order);

-- ═══ 2 · พนักงาน ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES branches(id) ON DELETE SET NULL,
  code            VARCHAR(20),                 -- Employee ID เช่น EMP-001
  name            VARCHAR(120) NOT NULL,
  nickname        VARCHAR(60),
  phone           VARCHAR(20),
  photo_url       TEXT,
  position        VARCHAR(80),
  employment_type VARCHAR(20) NOT NULL DEFAULT 'part_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'temporary', 'intern')),
  start_date      DATE,
  wage_type       VARCHAR(10) NOT NULL DEFAULT 'hourly'
    CHECK (wage_type IN ('hourly', 'daily', 'monthly')),
  wage_rate       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (wage_rate >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  hr_role         VARCHAR(10) NOT NULL DEFAULT 'staff'
    CHECK (hr_role IN ('staff', 'manager')),
  emergency_name  VARCHAR(120),
  emergency_phone VARCHAR(20),
  -- Staff Identity: เก็บเฉพาะ hash — token จริงโชว์ให้เจ้าของร้านครั้งเดียว
  -- ตอนสร้าง/rotate (สร้างใหม่จาก hash ไม่ได้ = DB หลุดลิงก์ไม่หลุด)
  token_hash       CHAR(64) UNIQUE,            -- sha256 hex ของ token
  token_expires_at TIMESTAMPTZ,                -- ไม่ permanent — default 180 วันจากโค้ด
  token_rotated_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user_code
  ON employees (user_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_user
  ON employees (user_id, status, name);
-- lookup จากลิงก์พนักงาน: WHERE token_hash = $1 (UNIQUE index ครอบแล้ว)

-- ═══ 3 · ประวัติค่าแรง (append-only — payroll ย้อนหลังตรวจได้) ═══

CREATE TABLE IF NOT EXISTS employee_wage_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  wage_type    VARCHAR(10) NOT NULL,
  wage_rate    NUMERIC(12,2) NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_wage_history_employee
  ON employee_wage_history (employee_id, recorded_at DESC);

-- trigger: ค่าแรงเปลี่ยนเมื่อไหร่บันทึกเสมอ — ครอบทุกทาง (UI/สคริปต์ SQL)
CREATE OR REPLACE FUNCTION fn_employee_log_wage() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.wage_type IS DISTINCT FROM OLD.wage_type
     OR NEW.wage_rate IS DISTINCT FROM OLD.wage_rate THEN
    INSERT INTO employee_wage_history (user_id, employee_id, wage_type, wage_rate)
    VALUES (NEW.user_id, NEW.id, NEW.wage_type, NEW.wage_rate);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employee_log_wage ON employees;
CREATE TRIGGER trg_employee_log_wage
  AFTER INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION fn_employee_log_wage();

-- ═══ 4 · ตั้งค่า HR ต่อร้าน (business rules = config ไม่ hardcode) ═══

CREATE TABLE IF NOT EXISTS hr_settings (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ot_multiplier       NUMERIC(4,2)  NOT NULL DEFAULT 1.5  CHECK (ot_multiplier >= 1),
  labor_target_pct    NUMERIC(5,2)  NOT NULL DEFAULT 30   CHECK (labor_target_pct > 0),
  payroll_cycle       VARCHAR(15)   NOT NULL DEFAULT 'monthly'
    CHECK (payroll_cycle IN ('monthly', 'semimonthly', 'weekly')),
  late_grace_minutes  INTEGER       NOT NULL DEFAULT 5    CHECK (late_grace_minutes >= 0),
  token_ttl_days      INTEGER       NOT NULL DEFAULT 180  CHECK (token_ttl_days BETWEEN 1 AND 730),
  leave_types         JSONB         NOT NULL DEFAULT
    '["sick","personal","vacation","other"]',
  performance_weights JSONB         NOT NULL DEFAULT
    '{"attendance":20,"productivity":30,"sales":20,"customer":20,"manager":10}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ 5 · Audit log ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor       VARCHAR(10) NOT NULL CHECK (actor IN ('owner', 'staff')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  action      VARCHAR(40) NOT NULL,     -- employee_created / employee_updated /
                                        -- status_changed / token_rotated / ...
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_audit_logs_user
  ON hr_audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_audit_logs_employee
  ON hr_audit_logs (employee_id, created_at DESC) WHERE employee_id IS NOT NULL;

-- ═══ 6 · Seed: ร้านที่ใช้ POS อยู่ ได้สาขาแรก + settings default ═══

INSERT INTO branches (user_id, name)
SELECT s.user_id, u.shop_name
FROM pos_shop_settings s JOIN users u ON u.id = s.user_id
WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.user_id = s.user_id);

INSERT INTO hr_settings (user_id)
SELECT user_id FROM pos_shop_settings
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
