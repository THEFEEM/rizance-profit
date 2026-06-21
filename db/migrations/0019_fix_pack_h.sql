-- Rizance Profit — Migration 0019 (Fix Pack H)
-- Personal savings manual balance + shop expense advance/creditor fields.
-- DO NOT RUN until approved. Safe to re-run (IF NOT EXISTS).
--
-- Schema verified against:
--   db/migrations/0016_personal_mode.sql  → savings_goals.target_amount NUMERIC(12,2)
--   db/schema.sql                         → expense_entries (shop), NOT shop_expenses

BEGIN;

-- 1) Personal savings: manual "saved so far" per goal (not derived from income/expense)
ALTER TABLE savings_goals
  ADD COLUMN IF NOT EXISTS current_amount NUMERIC(12,2) NOT NULL DEFAULT 0
  CHECK (current_amount >= 0);

-- 2) Shop expense advances (mirror booth/org is_advance + payer_name pattern)
ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS is_advance BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS payer_name VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_expense_user_advance
  ON expense_entries (user_id)
  WHERE is_advance = true;

COMMIT;
