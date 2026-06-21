-- Rizance Profit — Migration 0020 (Fix Pack I)
-- Personal savings as income/expense transactions linked to goals.
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).
--
-- Schema verified against:
--   db/migrations/0016_personal_mode.sql → savings_goals.id UUID (NOT INTEGER)
--   db/migrations/0019_fix_pack_h.sql    → savings_goals.current_amount exists

BEGIN;

-- 1) Extend personal category checks for savings deposit / withdrawal
ALTER TABLE personal_income_entries
  DROP CONSTRAINT IF EXISTS personal_income_entries_category_check;
ALTER TABLE personal_income_entries
  ADD CONSTRAINT personal_income_entries_category_check
  CHECK (category IN (
    'salary', 'business', 'freelance', 'scholarship',
    'family', 'bonus', 'loan_return', 'other_income',
    'savings_withdrawal'
  ));

ALTER TABLE personal_expense_entries
  DROP CONSTRAINT IF EXISTS personal_expense_entries_category_check;
ALTER TABLE personal_expense_entries
  ADD CONSTRAINT personal_expense_entries_category_check
  CHECK (category IN (
    'food', 'transport', 'education', 'rent', 'water',
    'electricity', 'internet', 'phone', 'health', 'clothing',
    'donation', 'installment', 'social', 'other_expense',
    'savings_deposit'
  ));

-- 2) Link savings transactions to goals (UUID FK — matches savings_goals.id)
ALTER TABLE personal_income_entries
  ADD COLUMN IF NOT EXISTS savings_goal_id UUID REFERENCES savings_goals(id) ON DELETE SET NULL;

ALTER TABLE personal_expense_entries
  ADD COLUMN IF NOT EXISTS savings_goal_id UUID REFERENCES savings_goals(id) ON DELETE SET NULL;

-- 3) Flags — filter out of normal income/expense summaries
ALTER TABLE personal_income_entries
  ADD COLUMN IF NOT EXISTS is_savings_withdrawal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE personal_expense_entries
  ADD COLUMN IF NOT EXISTS is_savings_deposit BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pie_savings_goal
  ON personal_income_entries (savings_goal_id)
  WHERE savings_goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pee_savings_goal
  ON personal_expense_entries (savings_goal_id)
  WHERE savings_goal_id IS NOT NULL;

COMMIT;
