-- 0013_project_fund_source — Phase 1A: link each expense to a funding source (ก้อนเงิน).
--
-- Additive only. No drops, no type changes, no data loss.
-- fund_source = same keys as income.source. NULL = กองกลาง (unassigned).
-- No backfill — existing rows stay NULL.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE INDEX IF NOT EXISTS.
-- Review before running on shared Supabase.

ALTER TABLE project_expense_entries
  ADD COLUMN IF NOT EXISTS fund_source VARCHAR(30);

ALTER TABLE project_expense_entries
  DROP CONSTRAINT IF EXISTS project_expense_entries_fund_source_check;
ALTER TABLE project_expense_entries
  ADD CONSTRAINT project_expense_entries_fund_source_check
  CHECK (fund_source IS NULL OR fund_source IN (
    'faculty_grant', 'membership', 'participant_fee', 'sponsor',
    'donation', 'activity_income', 'other_income'
  ));

CREATE INDEX IF NOT EXISTS idx_project_expense_fund_source
  ON project_expense_entries (activity_id, fund_source);
