-- 0010_booth_expense_category_backfill — B+ mapping (approved)
-- Run after 0009_category_system_round1.sql
-- cost_type column retained (legacy; booth-split still reads it in Round 1).

-- wage: fixed + payroll-ish labels
UPDATE booth_expense_entries
SET category = 'wage'
WHERE category IS NULL
  AND cost_type = 'fixed'
  AND (
    label ILIKE '%พนักงาน%'
    OR label ILIKE '%ค่าแรง%'
  );

-- rent: fixed + booth-fee label
UPDATE booth_expense_entries
SET category = 'rent'
WHERE category IS NULL
  AND cost_type = 'fixed'
  AND label ILIKE '%ค่าที่%';

-- expense_misc: fixed + fuel (semantics unclear — neutral bucket)
UPDATE booth_expense_entries
SET category = 'expense_misc'
WHERE category IS NULL
  AND cost_type = 'fixed'
  AND label ILIKE '%น้ำมัน%';

-- rent: remaining fixed (blank labels + other fixed)
UPDATE booth_expense_entries
SET category = 'rent'
WHERE category IS NULL
  AND cost_type = 'fixed';

-- materials: all variable (booth UI historically = วัตถุดิบ)
UPDATE booth_expense_entries
SET category = 'materials'
WHERE category IS NULL
  AND cost_type = 'variable';

-- Safety: anything still null → expense_misc
UPDATE booth_expense_entries
SET category = 'expense_misc'
WHERE category IS NULL;

ALTER TABLE booth_expense_entries
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE booth_expense_entries DROP CONSTRAINT IF EXISTS booth_expense_entries_category_check;
ALTER TABLE booth_expense_entries
  ADD CONSTRAINT booth_expense_entries_category_check
  CHECK (category IN (
    'rent', 'wage', 'equipment', 'materials',
    'utilities', 'shipping', 'marketing', 'expense_misc'
  ));
