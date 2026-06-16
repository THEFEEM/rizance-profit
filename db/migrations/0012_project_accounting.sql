-- 0012_project_accounting — Round 1B: project identity, planning status, payment_status.
--
-- Additive only. No drops, no type changes on existing columns.
-- Existing income/expense rows backfilled to payment_status = 'paid' (totals unchanged).
-- Re-runnable: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE INDEX IF NOT EXISTS.
--
-- Review before running on shared Supabase.

-- =========================================================
-- 2a. projects — project_code, objective, expand status
-- =========================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code VARCHAR(40);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS objective TEXT;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning', 'active', 'closed'));

-- =========================================================
-- 2c. project_income_entries — payment_status
-- =========================================================
ALTER TABLE project_income_entries
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(12);

UPDATE project_income_entries
SET payment_status = 'paid'
WHERE payment_status IS NULL;

ALTER TABLE project_income_entries
  ALTER COLUMN payment_status SET DEFAULT 'paid';

ALTER TABLE project_income_entries
  ALTER COLUMN payment_status SET NOT NULL;

ALTER TABLE project_income_entries
  DROP CONSTRAINT IF EXISTS project_income_entries_payment_status_check;
ALTER TABLE project_income_entries
  ADD CONSTRAINT project_income_entries_payment_status_check
  CHECK (payment_status IN ('pending', 'approved', 'paid', 'rejected'));

-- =========================================================
-- 2c. project_expense_entries — payment_status
-- =========================================================
ALTER TABLE project_expense_entries
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(12);

UPDATE project_expense_entries
SET payment_status = 'paid'
WHERE payment_status IS NULL;

ALTER TABLE project_expense_entries
  ALTER COLUMN payment_status SET DEFAULT 'paid';

ALTER TABLE project_expense_entries
  ALTER COLUMN payment_status SET NOT NULL;

ALTER TABLE project_expense_entries
  DROP CONSTRAINT IF EXISTS project_expense_entries_payment_status_check;
ALTER TABLE project_expense_entries
  ADD CONSTRAINT project_expense_entries_payment_status_check
  CHECK (payment_status IN ('pending', 'approved', 'paid', 'rejected'));

-- =========================================================
-- 2e. indexes for status filtering (Round 1C)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_project_income_status
  ON project_income_entries (activity_id, payment_status);

CREATE INDEX IF NOT EXISTS idx_project_expense_status
  ON project_expense_entries (activity_id, payment_status);
