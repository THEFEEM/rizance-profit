-- 0046_capital_transactions_payment_method.sql
-- Standard Column Addition Pattern (RTS-P5-C1 §4, RTS-P6-C2 §5.1)
-- Requires: 0024_capital_transactions.sql

BEGIN;

ALTER TABLE capital_transactions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
UPDATE capital_transactions SET payment_method = 'cash' WHERE payment_method IS NULL;
ALTER TABLE capital_transactions ALTER COLUMN payment_method SET DEFAULT 'cash';
ALTER TABLE capital_transactions ALTER COLUMN payment_method SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capital_transactions_payment_method_check'
  ) THEN
    ALTER TABLE capital_transactions
      ADD CONSTRAINT capital_transactions_payment_method_check
      CHECK (payment_method IN ('cash', 'transfer'));
  END IF;
END $$;

COMMIT;
