-- 0026_profit_withdrawal_payment — payment_method on profit_withdrawals (W2)
-- Mirror 0022 expense pattern. Backfill existing rows → 'cash' (pre-check was 0 rows).
-- Idempotent where possible.

ALTER TABLE profit_withdrawals
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

UPDATE profit_withdrawals
SET payment_method = 'cash'
WHERE payment_method IS NULL;

ALTER TABLE profit_withdrawals
  ALTER COLUMN payment_method SET DEFAULT 'cash';

ALTER TABLE profit_withdrawals
  ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE profit_withdrawals
  DROP CONSTRAINT IF EXISTS profit_withdrawals_payment_method_check;
ALTER TABLE profit_withdrawals
  ADD CONSTRAINT profit_withdrawals_payment_method_check
  CHECK (payment_method IN ('cash', 'transfer'));
