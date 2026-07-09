-- 0044_income_entries_soft_void — soft-void metadata on shop income_entries
-- Requires 0038_pos_core.sql (income_entries base table)

BEGIN;

ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_income_user_date_active
  ON income_entries (user_id, entry_date)
  WHERE voided_at IS NULL;

COMMIT;
