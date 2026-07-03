-- 0036_creditor_repayments_booth — booth-scoped manual creditor repayments
-- shop rows keep booth_id NULL; booth rows set booth_id (ON DELETE CASCADE).

BEGIN;

ALTER TABLE creditor_repayments
  ADD COLUMN IF NOT EXISTS booth_id UUID REFERENCES booths(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_creditor_repayments_booth
  ON creditor_repayments (booth_id, entry_date)
  WHERE booth_id IS NOT NULL;

COMMIT;
