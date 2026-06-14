-- 0009_category_system_round1 — widen income/expense categories + shop payment_method
-- Round 1: DB layer only. Booth expense category backfill is in 0010 (pending approval).
-- Idempotent where possible. Review row counts before running on shared Supabase.

-- =========================================================
-- 2a. Shop income (income_entries)
-- =========================================================

-- Map legacy income category before widening CHECK
UPDATE income_entries
SET category = 'other_income'
WHERE category = 'other';

-- Widen category CHECK to 6 income keys
ALTER TABLE income_entries DROP CONSTRAINT IF EXISTS income_entries_category_check;
ALTER TABLE income_entries
  ADD CONSTRAINT income_entries_category_check
  CHECK (category IN (
    'storefront', 'online', 'delivery', 'service', 'other_income', 'misc'
  ));

-- Shop income payment_method (cash | transfer)
ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

UPDATE income_entries
SET payment_method = 'cash'
WHERE payment_method IS NULL;

ALTER TABLE income_entries
  ALTER COLUMN payment_method SET DEFAULT 'cash';

ALTER TABLE income_entries
  ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE income_entries DROP CONSTRAINT IF EXISTS income_entries_payment_method_check;
ALTER TABLE income_entries
  ADD CONSTRAINT income_entries_payment_method_check
  CHECK (payment_method IN ('cash', 'transfer'));

-- =========================================================
-- 2b. Shop expense (expense_entries)
-- =========================================================

-- Remap legacy 6 shop expense keys → new 8-key model
UPDATE expense_entries SET category = 'materials'    WHERE category = 'supplies';
UPDATE expense_entries SET category = 'wage'         WHERE category = 'salary';
UPDATE expense_entries SET category = 'expense_misc' WHERE category = 'other';
-- rent, utilities, equipment: keys unchanged (still valid)

ALTER TABLE expense_entries DROP CONSTRAINT IF EXISTS expense_entries_category_check;
ALTER TABLE expense_entries
  ADD CONSTRAINT expense_entries_category_check
  CHECK (category IN (
    'rent', 'wage', 'equipment', 'materials',
    'utilities', 'shipping', 'marketing', 'expense_misc'
  ));

-- =========================================================
-- 2c (part 1). Booth income — add category column
-- =========================================================

ALTER TABLE booth_income_entries
  ADD COLUMN IF NOT EXISTS category VARCHAR(40);

UPDATE booth_income_entries
SET category = 'storefront'
WHERE category IS NULL;

ALTER TABLE booth_income_entries
  ALTER COLUMN category SET DEFAULT 'storefront';

ALTER TABLE booth_income_entries
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE booth_income_entries DROP CONSTRAINT IF EXISTS booth_income_entries_category_check;
ALTER TABLE booth_income_entries
  ADD CONSTRAINT booth_income_entries_category_check
  CHECK (category IN (
    'storefront', 'online', 'delivery', 'service', 'other_income', 'misc'
  ));

-- payment_method already exists on booth_income_entries (cash | transfer) — no change.

-- =========================================================
-- 2c (part 2). Booth expense — ADD category column ONLY
-- Backfill from cost_type is in 0010_booth_expense_category_backfill.sql
-- DO NOT RUN 0010 until mapping is approved.
-- =========================================================

ALTER TABLE booth_expense_entries
  ADD COLUMN IF NOT EXISTS category VARCHAR(30);

-- Intentionally left NULL until approved backfill runs.
-- cost_type column retained (legacy; booth-split still reads it in Round 1).
