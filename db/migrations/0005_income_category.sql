-- 0005_income_category — category on regular-shop income only
-- booth_income_entries unchanged (uses payment_method, not category)

ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'storefront'
    CHECK (category IN ('storefront', 'delivery', 'other'));

-- Existing rows automatically get 'storefront' via DEFAULT on ADD COLUMN.
-- No backfill UPDATE required.
