-- 0040_pos_bills_payment_method_promptpay — align pos_bills with POS UI (cash | promptpay)
-- Requires 0038_pos_core.sql. Remap legacy smoke-test rows before tightening CHECK.

BEGIN;

UPDATE pos_bills
SET payment_method = 'promptpay'
WHERE payment_method = 'transfer';

ALTER TABLE pos_bills DROP CONSTRAINT IF EXISTS pos_bills_payment_method_check;
ALTER TABLE pos_bills
  ADD CONSTRAINT pos_bills_payment_method_check
  CHECK (payment_method IN ('cash', 'promptpay'));

COMMIT;
