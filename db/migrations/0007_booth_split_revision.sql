-- 0007_booth_split_revision — pool shareholder flag, drop custom_percent
--
-- Locked product decisions (2026-06):
--   Profit-split recipients: pool (optional) + investors + managers (equity > 0).
--   pool_gets_share = true → pool_budget is a virtual shareholder weight.
--   pool_gets_share = false → pool excluded from split; investors + managers only.
--   manager: investor-like (investment_amount) + wage (deducted pre-split, like employee).
--   employee: wage only, no profit share (unchanged).
--   profit_split_method: equal | by_equity only (custom_percent removed).
--   split_percent column dropped — weights derived from equity / head count.
--   Pool share display-only "เข้ากองกลาง" — never mutates pool_budget column.
--
-- Pre-check: custom_percent rows → backfill to equal before constraint swap.
-- Re-runnable: IF EXISTS / IF NOT EXISTS, DO blocks for constraints.

-- =========================================================
-- booths — pool_gets_share
-- =========================================================

ALTER TABLE booths
  ADD COLUMN IF NOT EXISTS pool_gets_share BOOLEAN NOT NULL DEFAULT false;

-- =========================================================
-- profit_split_method — drop custom_percent
-- =========================================================

UPDATE booths
SET profit_split_method = 'equal'
WHERE profit_split_method = 'custom_percent';

DO $$
BEGIN
  ALTER TABLE booths DROP CONSTRAINT IF EXISTS booths_profit_split_method_check;
END $$;

DO $$
BEGIN
  ALTER TABLE booths
    ADD CONSTRAINT booths_profit_split_method_check
      CHECK (profit_split_method IN ('equal', 'by_equity'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================
-- booth_members — drop split_percent
-- =========================================================

ALTER TABLE booth_members
  DROP CONSTRAINT IF EXISTS booth_members_split_percent_check;

ALTER TABLE booth_members
  DROP COLUMN IF EXISTS split_percent;

-- Role CHECK (investor | employee | manager) unchanged from 0006.
