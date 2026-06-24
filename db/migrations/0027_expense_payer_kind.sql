-- 0027_expense_payer_kind — shop advance: member vs external (creditors 1A)
-- Mirror pattern: add nullable → backfill → default → check
-- Backfill existing advances → 'external' (safe; user can reclassify later)
-- payer_kind stays nullable: only advance rows use it (non-advance rows stay NULL)

BEGIN;

ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS payer_kind VARCHAR(20);

UPDATE expense_entries
SET payer_kind = 'external'
WHERE is_advance = true AND payer_kind IS NULL;

ALTER TABLE expense_entries
  ALTER COLUMN payer_kind SET DEFAULT 'external';

ALTER TABLE expense_entries
  DROP CONSTRAINT IF EXISTS expense_entries_payer_kind_check;
ALTER TABLE expense_entries
  ADD CONSTRAINT expense_entries_payer_kind_check
  CHECK (payer_kind IS NULL OR payer_kind IN ('member', 'external'));

COMMIT;
