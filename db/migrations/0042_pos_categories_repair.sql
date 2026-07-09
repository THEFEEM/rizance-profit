-- 0042_pos_categories_repair — align pos_categories with 0039 when CREATE TABLE IF NOT EXISTS was skipped
-- Safe on DBs that already have full schema (ADD IF NOT EXISTS / constraint guard).
-- Does NOT backfill or dedupe rows — if UNIQUE add fails due to duplicates, fix data first.

BEGIN;

ALTER TABLE pos_categories
  ADD COLUMN IF NOT EXISTS color VARCHAR(20);

ALTER TABLE pos_categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE pos_categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.pos_categories'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, name)'
  ) THEN
    ALTER TABLE pos_categories
      ADD CONSTRAINT pos_categories_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_categories_user_sort
  ON pos_categories (user_id, sort_order, name);

COMMIT;
