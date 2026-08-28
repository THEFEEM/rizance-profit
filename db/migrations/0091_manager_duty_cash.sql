-- ══════════════════════════════════════════════════════════════════
-- 0091 — รอบงานผู้จัดการ + สมุดเงินสดรายวัน
--
-- ═══ โมเดลงานผู้จัดการ (ตาม decision 28 ส.ค. 2569) ═══════════════
-- ผู้จัดการไม่ใช่พนักงานกะ — ทำงานเป็น "รอบ" (ซื้อของ ตรวจร้าน ตรวจเงิน)
--   · เป้า 3 รอบ/สัปดาห์ (อาทิตย์–เสาร์ ตรงกับ pool/กะเดิม)
--   · ค่าตอบแทน ฿600/สัปดาห์ — ตัวเลขสุดท้ายมาจาก "เจ้าของอนุมัติ" เท่านั้น
--   · ทำ 2/3 รอบ ระบบห้ามสรุปเองว่าจ่าย ฿400 — แค่ชี้ให้เจ้าของเห็นแล้วรอตัดสิน
--   · เวลาเริ่ม/จบรอบเก็บไว้เพื่อ audit เท่านั้น ห้ามใช้คูณเงินเด็ดขาด
--
-- ═══ แหล่งเงินเดือนผู้จัดการ (invariant ที่เจ้าของสั่ง) ═══════════
--   Manager Payroll Source = Owner Approved Weekly Compensation
--   · manager_daily_rate (0083) deprecate — ไม่ลบ schema แต่ห้ามเป็นแหล่งเงิน
--     ในงวดใหม่ (มีผลงวด payroll ถัดไป งวดที่เปิดอยู่ใช้สูตรเดิม — บังคับที่
--     application ตอน M3 เพราะ "งวดถัดไป" เป็นเรื่องเวลา ไม่ใช่เรื่อง schema)
--   · Staff Pool Manager Contribution = 0 — ผู้จัดการไม่รับส่วนแบ่ง pool
--     อัตโนมัติ ถ้าไปยืนขายจริงให้เจ้าของเพิ่มผ่าน payroll_adjust_lines + reason
--
-- ═══ สมุดเงินสดรายวัน ════════════════════════════════════════════
--   Expected = Opening + CashSales − CashExpenses + CashIn − Withdrawals
--   Difference = Actual − Expected
--   · ยอดขายเงินสด: อ่านจาก pos_bills (paid + cash + entry_date) ไม่ให้กรอก
--   · รายจ่ายเงินสด: อ่านจาก expense_entries (payment_method='cash') แหล่งเดียว
--     — purchase 0085 เขียนลงตารางนั้นอยู่แล้ว จึงไม่มีทาง double count
--   · ตารางใหม่เก็บเฉพาะสิ่งที่ยังไม่มีที่อยู่: เงินเข้า/ถอนออก + ผลการนับ
--   · ปิดเช็คแล้ว = snapshot ถาวร (void/แก้ expense ย้อนหลังทำให้ตัวเลขสด
--     ขยับได้ แต่รายงานที่ส่งเจ้าของไปแล้วห้ามขยับตาม)
--
-- ⚠️ additive ล้วน · ไม่ลบ ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1 · ข้อตกลงค่าตอบแทนผู้จัดการ (ระดับร้าน) ════════════════════

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS manager_weekly_wage NUMERIC(12,2) NOT NULL DEFAULT 600;
ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS manager_weekly_duties SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_settings_manager_weekly_wage_check') THEN
    ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_manager_weekly_wage_check
      CHECK (manager_weekly_wage >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_settings_manager_weekly_duties_check') THEN
    ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_manager_weekly_duties_check
      CHECK (manager_weekly_duties BETWEEN 1 AND 14);
  END IF;
END $$;

-- manager_daily_rate (0083): DEPRECATED — คงไว้เพื่อไม่พังงวดเก่า
COMMENT ON COLUMN hr_settings.manager_daily_rate IS
  'DEPRECATED ตั้งแต่ 0091 — ค่าจ้างผู้จัดการมาจาก manager_week_approvals เท่านั้น (งวดใหม่) ห้ามใช้คำนวณเงินในโค้ดใหม่';


-- ═══ 2 · รอบงานผู้จัดการ ══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manager_duties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  duty_no       VARCHAR(32) NOT NULL,            -- MD-20260828-01
  business_date DATE NOT NULL,

  status        VARCHAR(12) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled')),

  -- เวลาไว้ audit เท่านั้น — ห้ามคูณเงิน (ดูหัวไฟล์)
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,

  -- snapshot สรุปรอบ ณ ตอนปิด (ชื่อผู้จัดการ · ตัวเลขต่อ mission · ข้อความรายงาน)
  -- เป็นเอกสารที่ส่งเจ้าของแล้ว — ห้ามขยับตามข้อมูลที่แก้ทีหลัง
  summary       JSONB,
  owner_note    VARCHAR(2000),                   -- สิ่งที่ต้องแจ้งเจ้าของ

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, duty_no),
  -- ปิดรอบแล้วต้องมีเวลาปิดและสรุปครบ
  CONSTRAINT manager_duties_completed_check CHECK (
    status <> 'completed' OR (completed_at IS NOT NULL AND summary IS NOT NULL)
  )
);

-- วันเดียวเปิดได้รอบเดียวต่อผู้จัดการ (ยกเลิกแล้วเปิดใหม่ได้ — partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_duties_one_per_day
  ON manager_duties (user_id, employee_id, business_date)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_manager_duties_user_date
  ON manager_duties (user_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_manager_duties_employee
  ON manager_duties (employee_id, business_date DESC);


-- ═══ 3 · รายการงานในรอบ — อ้างเช็คลิสต์เดิม (0084) ไม่สร้างชุดใหม่ ═══
--
-- สถานะ 4 แบบตามสเปค:
--   pending      ○ ยังไม่ทำ
--   done         ✓ เสร็จ (ติ๊กเอง หรือระบบยืนยันให้จากหลักฐานจริง)
--   not_required — ไม่จำเป็นรอบนี้ (เช่น ไม่ต้องซื้อของ) — ต้องบอกเหตุผล
--   issue        ⚠ พบปัญหา — ผูกกับ store_notes เพื่อให้ปัญหาไม่หายไปกับรอบ

CREATE TABLE IF NOT EXISTS manager_duty_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_id        UUID NOT NULL REFERENCES manager_duties(id) ON DELETE CASCADE,
  -- ลบ template ทีหลังรายงานเก่าต้องยังอ่านได้ → SET NULL + snapshot ชื่อไว้
  template_id    UUID REFERENCES shift_checklists(id) ON DELETE SET NULL,
  title          VARCHAR(200) NOT NULL,           -- snapshot ณ ตอนเปิดรอบ
  sort_order     INTEGER NOT NULL DEFAULT 0,

  status         VARCHAR(14) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'not_required', 'issue')),

  -- หลักฐานจากระบบจริง (System Evidence > Manual Checkbox)
  -- เช่น {"kind":"purchase","purchaseId":"...","items":12,"total":"1840.00"}
  --      {"kind":"production","batchId":"...","qty":"1590"}
  --      {"kind":"cash_check","checkId":"...","difference":"0.00"}
  -- โครงจริงเป็นเรื่องของ application — DB เก็บให้เฉย ๆ ไม่ enforce โครงใน MVP
  evidence       JSONB,

  -- ไม่จำเป็นรอบนี้ → ต้องบอกเหตุผล (บังคับที่ DB ไม่ใช่แค่ UI)
  not_required_reason VARCHAR(255),
  -- พบปัญหา → ผูกกับสมุดร้าน ปัญหาจะได้มีที่ติดตามต่อ
  note_id        UUID REFERENCES store_notes(id) ON DELETE SET NULL,

  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (duty_id, title),
  CONSTRAINT manager_duty_items_not_required_check CHECK (
    status <> 'not_required' OR not_required_reason IS NOT NULL
  ),
  CONSTRAINT manager_duty_items_issue_check CHECK (
    status <> 'issue' OR note_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_manager_duty_items_duty
  ON manager_duty_items (duty_id, sort_order);


-- ═══ 4 · การอนุมัติค่าตอบแทนรายสัปดาห์ — แหล่งเงินเดือนผู้จัดการ ═══
--
-- นี่คือ Source of Truth เพียงแหล่งเดียวของเงินผู้จัดการในงวดใหม่
-- ระบบเสนอ default = hr_settings.manager_weekly_wage (฿600)
-- เจ้าของกด [อนุมัติ ฿600] หรือ [ปรับค่าจ้าง] — ปรับต้องมีเหตุผล

CREATE TABLE IF NOT EXISTS manager_week_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  -- สัปดาห์อาทิตย์–เสาร์ ระบุด้วยวันอาทิตย์ที่เริ่ม
  week_start      DATE NOT NULL,

  -- ตัวเลขบอกเจ้าของประกอบการตัดสิน — snapshot ตอนอนุมัติ ไม่ใช่สูตรหักเงิน
  duties_done     SMALLINT NOT NULL DEFAULT 0 CHECK (duties_done >= 0),
  duties_target   SMALLINT NOT NULL DEFAULT 3 CHECK (duties_target >= 1),

  -- ข้อตกลง ณ สัปดาห์นั้น (กันตีความย้อนหลังถ้าเจ้าของแก้ค่าตั้งต้นทีหลัง)
  agreed_amount   NUMERIC(12,2) NOT NULL CHECK (agreed_amount >= 0),
  -- ยอดที่อนุมัติจริง — นี่คือตัวเลขที่เข้า payroll
  approved_amount NUMERIC(12,2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  -- ปรับไม่เท่าข้อตกลง → ต้องบอกเหตุผล (บังคับที่ DB)
  adjust_reason   VARCHAR(255),

  status          VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved')),
  approved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- สัปดาห์ละหนึ่งใบต่อผู้จัดการ
  UNIQUE (user_id, employee_id, week_start),

  -- อนุมัติแล้วต้องมียอดและเวลา
  CONSTRAINT manager_week_approvals_approved_check CHECK (
    status <> 'approved' OR (approved_amount IS NOT NULL AND approved_at IS NOT NULL)
  ),
  -- ยอดต่างจากข้อตกลง → ต้องมีเหตุผล · เท่ากันไม่ต้อง
  CONSTRAINT manager_week_approvals_reason_check CHECK (
    status <> 'approved'
    OR approved_amount = agreed_amount
    OR adjust_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_manager_week_approvals_user_week
  ON manager_week_approvals (user_id, week_start DESC);


-- ═══ 5 · สมุดเงินสดรายวัน ═════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_cash_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date  DATE NOT NULL,

  -- เงินยกมา: carried = ยกจากเช็คที่ปิดแล้วของวันก่อน · manual = นับจริงกรอกเอง
  -- (วันแรกของร้าน หรือวันที่ไม่มีเช็คก่อนหน้า ต้อง manual)
  opening_cash   NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
  opening_source VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (opening_source IN ('carried', 'manual')),

  status         VARCHAR(12) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed')),

  -- ── snapshot ตอนปิดเช็ค — ทั้งบล็อกนี้ NULL ระหว่างเปิด และห้ามแก้หลังปิด ──
  -- เหตุผลที่ต้อง snapshot: void บิล / แก้ expense ย้อนหลังทำให้ยอดคำนวณสด
  -- ขยับได้ แต่รายงานที่ผู้จัดการส่งเจ้าของไปแล้วต้องนิ่ง
  cash_sales     NUMERIC(12,2) CHECK (cash_sales IS NULL OR cash_sales >= 0),
  cash_expenses  NUMERIC(12,2) CHECK (cash_expenses IS NULL OR cash_expenses >= 0),
  cash_in        NUMERIC(12,2) CHECK (cash_in IS NULL OR cash_in >= 0),
  withdrawals    NUMERIC(12,2) CHECK (withdrawals IS NULL OR withdrawals >= 0),
  expected_cash  NUMERIC(12,2),
  actual_cash    NUMERIC(12,2) CHECK (actual_cash IS NULL OR actual_cash >= 0),
  difference     NUMERIC(12,2),

  -- เงินไม่ตรง → ต้องบอกเหตุผล (บังคับที่ DB — ห้ามปิดด้วยเหตุผลว่าง)
  difference_reason VARCHAR(255),

  -- ใครนับ — snapshot ชื่อไว้ด้วย เผื่อพนักงานถูกลบทีหลัง
  counted_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  counted_by_name        VARCHAR(120),
  completed_at   TIMESTAMPTZ,

  -- รอบงานผู้จัดการที่เช็คนี้เกิดขึ้น (ไว้ auto-complete Mission 5)
  duty_id        UUID REFERENCES manager_duties(id) ON DELETE SET NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- MVP: วันละครั้งเดียว ไม่รองรับหลายกะ (decision 28 ส.ค.)
  UNIQUE (user_id, business_date),

  -- ปิดเช็คแล้ว snapshot ต้องครบทุกช่อง
  CONSTRAINT daily_cash_checks_completed_check CHECK (
    status <> 'completed' OR (
      cash_sales    IS NOT NULL AND
      cash_expenses IS NOT NULL AND
      cash_in       IS NOT NULL AND
      withdrawals   IS NOT NULL AND
      expected_cash IS NOT NULL AND
      actual_cash   IS NOT NULL AND
      difference    IS NOT NULL AND
      counted_by_name IS NOT NULL AND
      completed_at  IS NOT NULL
    )
  ),
  -- สมการเงินสด — DB ตรวจซ้ำไม่ว่าตัวเลขมาจากทางไหน
  CONSTRAINT daily_cash_checks_equation_check CHECK (
    status <> 'completed'
    OR expected_cash = opening_cash + cash_sales - cash_expenses + cash_in - withdrawals
  ),
  CONSTRAINT daily_cash_checks_difference_check CHECK (
    status <> 'completed' OR difference = actual_cash - expected_cash
  ),
  -- เงินขาด/เกิน → ต้องมีเหตุผล · ตรงเป๊ะไม่ต้อง
  CONSTRAINT daily_cash_checks_reason_check CHECK (
    status <> 'completed' OR difference = 0 OR difference_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_cash_checks_user_date
  ON daily_cash_checks (user_id, business_date DESC);


-- ═══ 6 · เงินเข้า/ถอนออกจากลิ้นชัก ════════════════════════════════
--
-- เก็บเฉพาะสิ่งที่ "ยังไม่มีที่อยู่" ในระบบ:
--   cash_in    = เจ้าของเติมเงินทอน  → เงินสดเพิ่ม · ไม่ใช่รายได้
--   withdrawal = ถอนไปฝากธนาคาร     → เงินสดลด   · ไม่ใช่รายจ่าย (กำไรไม่เปลี่ยน)
--   adjustment = แก้ยอดตามการนับจริง (เผื่ออนาคต — โครงรองรับไว้)
--
-- ✗ ไม่มี 'sale'    — อ่านจาก pos_bills (paid + cash) แหล่งเดิม
-- ✗ ไม่มี 'expense' — อ่านจาก expense_entries (payment_method='cash') แหล่งเดิม
--   ใส่ซ้ำที่นี่ = double count ซึ่งเป็นสิ่งที่ห้ามตั้งแต่ต้น

CREATE TABLE IF NOT EXISTS cash_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,

  movement_type VARCHAR(12) NOT NULL
    CHECK (movement_type IN ('cash_in', 'withdrawal', 'adjustment')),
  -- จำนวนเป็นบวกเสมอ ทิศทางอยู่ที่ movement_type (อ่านรายงานง่ายกว่าเลขติดลบ)
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason        VARCHAR(255) NOT NULL,           -- ทุกการขยับเงินต้องบอกเหตุผล

  created_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by_name        VARCHAR(120),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_user_date
  ON cash_movements (user_id, business_date DESC);

COMMIT;


-- ══════════════════════════════════════════════════════════════════
-- ตรวจหลังรัน
-- ══════════════════════════════════════════════════════════════════
--
-- 1) ตารางใหม่ครบ 4 + คอลัมน์ hr_settings 2
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('manager_duties','manager_duty_items',
--                      'manager_week_approvals','daily_cash_checks','cash_movements')
-- ORDER BY 1;
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='hr_settings' AND column_name LIKE 'manager_weekly%';
--
-- 2) สมการเงินสดถูกบังคับจริง — คำสั่งนี้ต้อง "ล้มเหลว"
--    (expected ผิดจากสมการ 298−140+327=485)
--
-- INSERT INTO daily_cash_checks (user_id, business_date, opening_cash, status,
--   cash_sales, cash_expenses, cash_in, withdrawals,
--   expected_cash, actual_cash, difference, counted_by_name, completed_at)
-- SELECT id, '2026-08-27', 298, 'completed', 327, 140, 0, 0,
--   999, 485, -514, 'ทดสอบ', now()
-- FROM users LIMIT 1;
--
-- 3) เงินขาดโดยไม่บอกเหตุผล — ต้อง "ล้มเหลว" เช่นกัน
--    (สลับ expected เป็น 485 / actual 475 / difference -10 / ไม่ใส่ reason)
--
-- ══════════════════════════════════════════════════════════════════
-- ยังไม่ได้ทำใน migration นี้ (งาน M1–M3 ฝั่ง application หลัง review)
-- ══════════════════════════════════════════════════════════════════
--
-- M1 · duty engine (เปิดรอบ→copy 11 ข้อจาก template→ปิดรอบ+summary snapshot)
--      + /e ของ manager: ถอด timer/เงินวันนี้ → Duty home + 5 Mission
-- M2 · cash engine: expected คำนวณจาก pos_bills + expense_entries + movements
--      (server เท่านั้น — ห้าม client ส่งค่าคำนวณ) + copy report (Clipboard)
-- M3 · เปลี่ยนกิ่ง manager ใน calcItemsFromPool → อ่าน manager_week_approvals
--      · มีผล "งวด payroll ที่เริ่มหลัง deploy" งวดที่เปิดอยู่ใช้สูตรเดิม
--      · Staff Pool Manager Contribution = 0 (extra งานพนักงาน → adjust_lines)
--      · owner approve ผ่าน requirePosSessionAndPlan + requireManagerUnlock
-- ══════════════════════════════════════════════════════════════════
