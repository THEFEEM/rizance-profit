-- 0041_pos_products_unit_sort_order — product display unit + sort order for POS sell screen
-- Requires 0038_pos_core.sql (and 0039 for category_id). Additive only.

BEGIN;

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

COMMIT;
