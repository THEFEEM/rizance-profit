-- 0037_booth_expense_payment_method — cash vs transfer on booth expenses
-- Existing rows default to cash (booth pool / advances were cash-only).

BEGIN;

ALTER TABLE booth_expense_entries
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';

ALTER TABLE booth_expense_entries DROP CONSTRAINT IF EXISTS booth_expense_entries_payment_method_check;
ALTER TABLE booth_expense_entries
  ADD CONSTRAINT booth_expense_entries_payment_method_check
    CHECK (payment_method IN ('cash', 'transfer'));

COMMIT;
