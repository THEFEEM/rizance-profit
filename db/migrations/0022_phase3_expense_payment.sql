-- 0022_phase3_expense_payment — payment_method for shop expense_entries (Phase 3)
-- Mirror of 0009 income_entries pattern: nullable → backfill → default → not null → check
-- Scope: expense_entries only (not personal/booth/project)
-- Idempotent where possible. Review pre-check row counts before running on shared Supabase.

ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

UPDATE expense_entries
SET payment_method = 'cash'
WHERE payment_method IS NULL;

ALTER TABLE expense_entries
  ALTER COLUMN payment_method SET DEFAULT 'cash';

ALTER TABLE expense_entries
  ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE expense_entries DROP CONSTRAINT IF EXISTS expense_entries_payment_method_check;
ALTER TABLE expense_entries
  ADD CONSTRAINT expense_entries_payment_method_check
  CHECK (payment_method IN ('cash', 'transfer'));
