-- Rizance Profit — Migration 0014
-- General activity ("กองกลาง") for long-term projects + org accounting fields.

BEGIN;

-- 2a) project_activities — add is_general flag
ALTER TABLE project_activities
  ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT false;

-- 2b) Backfill: create กองกลาง for existing long-term projects (re-runnable)
INSERT INTO project_activities (
  project_id,
  user_id,
  name,
  budget_target,
  start_date,
  end_date,
  status,
  is_general,
  sort_order
)
SELECT
  p.id,
  p.user_id,
  'กองกลาง',
  0,
  p.start_date,
  p.end_date,
  CASE WHEN p.status = 'closed' THEN 'closed' ELSE 'active' END,
  true,
  -1
FROM projects p
WHERE p.project_type = 'long'
  AND NOT EXISTS (
    SELECT 1
    FROM project_activities a
    WHERE a.project_id = p.id AND a.is_general = true
  );

-- 2c) project_income_entries — add payment_method
ALTER TABLE project_income_entries
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(12)
    NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'transfer'));

-- 2d) project_expense_entries — add advance tracking fields
ALTER TABLE project_expense_entries
  ADD COLUMN IF NOT EXISTS is_advance BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE project_expense_entries
  ADD COLUMN IF NOT EXISTS reimbursed_at TIMESTAMPTZ;

-- 2e) Indexes
CREATE INDEX IF NOT EXISTS idx_project_activities_general
  ON project_activities (project_id, is_general);

CREATE INDEX IF NOT EXISTS idx_project_expense_advance
  ON project_expense_entries (activity_id, is_advance)
  WHERE is_advance = true;

COMMIT;

