-- 0006_booth_v2 — booth capital structure, members, advances, profit-split prep
--
-- Locked product decisions (2026-06):
--   totalBudget = pool_budget + SUM(investment_amount) — derived in app only
--   starting_budget DROPPED (backfilled into pool_budget first)
--   employee wages on member rows (not expense_entries); computed in app
--   advances: payer_member_id on booth_expense_entries
--   profit_split_method on booth (equal | by_equity | custom_percent)
--
-- Pre-check (2026-06-11): booth_members has 0 rows — role enum safe without backfill.
-- booths has 3 rows — pool_budget backfill from starting_budget required before drop.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, DROP COLUMN IF EXISTS, DO blocks for constraints.

-- =========================================================
-- booths — pool_budget, profit_split_method; drop starting_budget
-- =========================================================

ALTER TABLE booths
  ADD COLUMN IF NOT EXISTS pool_budget NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE booths
  ADD COLUMN IF NOT EXISTS profit_split_method VARCHAR(20) NOT NULL DEFAULT 'equal';

-- pool_budget >= 0 (idempotent)
DO $$
BEGIN
  ALTER TABLE booths
    ADD CONSTRAINT booths_pool_budget_check CHECK (pool_budget >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- profit_split_method enum (idempotent)
DO $$
BEGIN
  ALTER TABLE booths
    ADD CONSTRAINT booths_profit_split_method_check
      CHECK (profit_split_method IN ('equal', 'by_equity', 'custom_percent'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill pool_budget from starting_budget while column still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booths'
      AND column_name = 'starting_budget'
  ) THEN
    UPDATE booths
    SET pool_budget = starting_budget
    WHERE pool_budget IS DISTINCT FROM starting_budget;
  END IF;
END $$;

-- Drop deprecated lump-sum budget (no DB views/indexes depend on it)
ALTER TABLE booths
  DROP COLUMN IF EXISTS starting_budget;

-- =========================================================
-- booth_members — role enum, investment, split %, wages
-- =========================================================

ALTER TABLE booth_members
  ADD COLUMN IF NOT EXISTS investment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE booth_members
  ADD COLUMN IF NOT EXISTS split_percent NUMERIC(5,2);

ALTER TABLE booth_members
  ADD COLUMN IF NOT EXISTS wage_amount NUMERIC(12,2);

ALTER TABLE booth_members
  ADD COLUMN IF NOT EXISTS wage_type VARCHAR(10);

-- role: VARCHAR(60) → VARCHAR(20) NOT NULL enum (0 existing rows — no UPDATE needed)
ALTER TABLE booth_members
  ALTER COLUMN role TYPE VARCHAR(20);

ALTER TABLE booth_members
  ALTER COLUMN role SET DEFAULT 'employee';

UPDATE booth_members
SET role = 'employee'
WHERE role IS NULL OR role NOT IN ('investor', 'employee', 'manager');

ALTER TABLE booth_members
  ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE booth_members
    ADD CONSTRAINT booth_members_role_check
      CHECK (role IN ('investor', 'employee', 'manager'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE booth_members
    ADD CONSTRAINT booth_members_investment_amount_check
      CHECK (investment_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE booth_members
    ADD CONSTRAINT booth_members_split_percent_check
      CHECK (split_percent IS NULL OR (split_percent >= 0 AND split_percent <= 100));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE booth_members
    ADD CONSTRAINT booth_members_wage_amount_check
      CHECK (wage_amount IS NULL OR wage_amount >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE booth_members
    ADD CONSTRAINT booth_members_wage_type_check
      CHECK (wage_type IS NULL OR wage_type IN ('daily', 'event'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Role-conditional rules enforced in app (investor/employee/manager field combos).

-- =========================================================
-- booth_expense_entries — advance / out-of-pocket payer
-- =========================================================

ALTER TABLE booth_expense_entries
  ADD COLUMN IF NOT EXISTS payer_member_id UUID;

-- FK (idempotent via DO)
DO $$
BEGIN
  ALTER TABLE booth_expense_entries
    ADD CONSTRAINT booth_expense_entries_payer_member_id_fkey
      FOREIGN KEY (payer_member_id) REFERENCES booth_members(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================
-- indexes
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_booth_expense_payer
  ON booth_expense_entries (payer_member_id)
  WHERE payer_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booth_members_booth_role
  ON booth_members (booth_id, role);
